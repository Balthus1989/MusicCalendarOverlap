/**
 * Il layer di notifica (ARCHITECTURE.md §10, ADR-0035, ADR-0036).
 *
 * È l'unico punto del progetto che scrive in `notifications` e l'unico che
 * parla ai sink. Chi vuole avvisare qualcuno costruisce degli `Avviso` con i
 * testi puri di `messages.ts` e li consegna qui: non sa quali canali esistano,
 * né quali preferenze abbia il destinatario.
 *
 * Due garanzie, e sono quelle che rendono il resto semplice:
 *
 * 1. **Non solleva mai.** Un avviso non consegnato non deve far fallire il
 *    salvataggio che l'ha provocato — la stessa scelta dell'audit e del
 *    ricalcolo dei conflitti.
 * 2. **Non ripete.** La chiave di deduplica è un indice unico nel database e
 *    non un controllo in JavaScript: due corse notturne sovrapposte non
 *    possono mandare lo stesso sollecito due volte.
 */
import { and, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import type { Database } from '$lib/server/db/client';
import { notificationPrefs, notifications, profiles } from '$lib/server/db/schema';
import { leggiContenuto } from '$lib/notifications';
import { sinkAttivi } from './sinks';
import {
	PREFERENZE_PREDEFINITE,
	vuoleEmail,
	type Avviso,
	type Destinatario,
	type Preferenze
} from './types';

export type EsitoNotifica = {
	/** Righe scritte davvero: le ripetizioni non contano. */
	registrate: number;
	/** Avvisi già presenti, scartati dalla chiave di deduplica. */
	ripetuti: number;
	emailSpedite: number;
	emailFallite: number;
};

const VUOTO: EsitoNotifica = { registrate: 0, ripetuti: 0, emailSpedite: 0, emailFallite: 0 };

/* ------------------------------------------------------------------ *
 * Preferenze
 * ------------------------------------------------------------------ */

/**
 * Le preferenze dei profili indicati. L'assenza di riga vale "tutto acceso":
 * un profilo appena creato dev'essere avvisato di un conflitto grave, e farlo
 * dipendere da una riga mai inserita sarebbe un silenzio per errore.
 */
export async function preferenzeDi(
	db: Database,
	profileIds: string[]
): Promise<Map<string, Preferenze>> {
	const mappa = new Map<string, Preferenze>();
	if (!profileIds.length) return mappa;

	const righe = await db
		.select()
		.from(notificationPrefs)
		.where(inArray(notificationPrefs.profileId, profileIds));

	for (const r of righe) {
		mappa.set(r.profileId, {
			emailConflitti: r.emailConflitti,
			emailDigest: r.emailDigest,
			emailSolleciti: r.emailSolleciti
		});
	}
	for (const id of profileIds) {
		if (!mappa.has(id)) mappa.set(id, PREFERENZE_PREDEFINITE);
	}
	return mappa;
}

/** Legge le preferenze di un profilo solo, per la pagina delle impostazioni. */
export async function preferenzeDelProfilo(db: Database, profileId: string): Promise<Preferenze> {
	const mappa = await preferenzeDi(db, [profileId]);
	return mappa.get(profileId) ?? PREFERENZE_PREDEFINITE;
}

export async function salvaPreferenze(
	db: Database,
	profileId: string,
	preferenze: Preferenze
): Promise<void> {
	await db
		.insert(notificationPrefs)
		.values({ profileId, ...preferenze, updatedAt: new Date() })
		.onConflictDoUpdate({
			target: notificationPrefs.profileId,
			set: { ...preferenze, updatedAt: new Date() }
		});
}

/* ------------------------------------------------------------------ *
 * Consegna
 * ------------------------------------------------------------------ */

type RigaDaSpedire = { id: string; avviso: Avviso };

/**
 * Manda le email e segna l'esito riga per riga.
 *
 * `emailed_at` si scrive solo su ciò che è partito davvero: ciò che resta a
 * `NULL` è la coda che la corsa notturna ritenta. `email_error` conserva il
 * motivo dell'ultimo tentativo, che è l'unica cosa che permette di capire se
 * il problema è la chiave, il dominio o un indirizzo sbagliato.
 */
async function consegnaEmail(db: Database, righe: RigaDaSpedire[]): Promise<[number, number]> {
	if (!righe.length) return [0, 0];

	const attivi = sinkAttivi();
	if (!attivi.length) {
		// Nessun canale configurato: le righe restano in coda. È lo stato
		// normale di uno sviluppo locale senza chiave Resend, e non deve
		// riempire il registro di errori.
		return [0, 0];
	}

	// Un avviso può avere più righe (stesso profilo, sink diversi in futuro):
	// l'indice per `profileId` basta finché il sink è uno solo per destinatario.
	const perProfilo = new Map<string, RigaDaSpedire[]>();
	for (const r of righe) {
		const elenco = perProfilo.get(r.avviso.destinatario.profileId) ?? [];
		elenco.push(r);
		perProfilo.set(r.avviso.destinatario.profileId, elenco);
	}

	let spedite = 0;
	let fallite = 0;
	const adesso = new Date();

	for (const sink of attivi) {
		const esito = await sink.consegna(righe.map((r) => r.avviso));

		const idRiusciti = esito.riusciti.flatMap((p) => (perProfilo.get(p) ?? []).map((r) => r.id));
		if (idRiusciti.length) {
			await db
				.update(notifications)
				.set({ emailedAt: adesso, emailError: null })
				.where(inArray(notifications.id, idRiusciti));
			spedite += idRiusciti.length;
		}

		for (const f of esito.falliti) {
			const ids = (perProfilo.get(f.profileId) ?? []).map((r) => r.id);
			if (!ids.length) continue;
			await db
				.update(notifications)
				.set({ emailError: f.motivo.slice(0, 500) })
				.where(inArray(notifications.id, ids));
			fallite += ids.length;
		}
	}

	return [spedite, fallite];
}

/**
 * Registra gli avvisi e consegna quelli che prevedono un'email.
 *
 * Il valore di ritorno serve ai job periodici, che lo mettono nella risposta
 * JSON: è l'unico modo di sapere da fuori se una corsa ha fatto qualcosa.
 */
export async function notifica(db: Database, avvisi: Avviso[]): Promise<EsitoNotifica> {
	if (!avvisi.length) return { ...VUOTO };

	try {
		const preferenze = await preferenzeDi(db, [
			...new Set(avvisi.map((a) => a.destinatario.profileId))
		]);

		const daInserire = avvisi.map((a) => ({
			profileId: a.destinatario.profileId,
			kind: a.kind,
			payload: { titolo: a.titolo, testo: a.testo, url: a.url },
			dedupeKey: a.dedupeKey,
			emailRequested: vuoleEmail(
				a.kind,
				preferenze.get(a.destinatario.profileId) ?? PREFERENZE_PREDEFINITE
			)
		}));

		/**
		 * `onConflictDoNothing` sull'indice unico `(profile_id, dedupe_key)`.
		 *
		 * Le righe già presenti non tornano indietro, ed è esattamente il
		 * comportamento voluto: un avviso già dato non si ridà. Le righe con
		 * `dedupe_key` a `NULL` passano sempre, perché in Postgres due `NULL`
		 * non si considerano uguali — sono gli avvisi che nascono da un fatto
		 * puntuale e non da una scansione che ripasserà.
		 */
		const inserite = await db
			.insert(notifications)
			.values(daInserire)
			.onConflictDoNothing({ target: [notifications.profileId, notifications.dedupeKey] })
			.returning({
				id: notifications.id,
				profileId: notifications.profileId,
				dedupeKey: notifications.dedupeKey,
				emailRequested: notifications.emailRequested
			});

		// Riaggancia ogni riga scritta al suo avviso: serve il testo per
		// spedirlo, e la riga in tabella ha solo il payload.
		const perChiave = new Map(
			avvisi.map((a) => [`${a.destinatario.profileId}|${a.dedupeKey ?? ''}`, a])
		);
		const daSpedire: RigaDaSpedire[] = [];
		for (const riga of inserite) {
			if (!riga.emailRequested) continue;
			const avviso = perChiave.get(`${riga.profileId}|${riga.dedupeKey ?? ''}`);
			// Con `dedupe_key` a `NULL` più avvisi allo stesso profilo
			// collassano sulla stessa chiave di ricerca. Non è un problema
			// pratico — nascono uno alla volta — ma se capitasse, spedire due
			// volte lo stesso testo è meglio che spedire il testo sbagliato.
			if (avviso) daSpedire.push({ id: riga.id, avviso });
		}

		const [emailSpedite, emailFallite] = await consegnaEmail(db, daSpedire);

		return {
			registrate: inserite.length,
			ripetuti: avvisi.length - inserite.length,
			emailSpedite,
			emailFallite
		};
	} catch (err) {
		// Vedi l'intestazione: mai far fallire chi ci ha chiamato.
		console.error('Notifiche non consegnate:', err);
		return { ...VUOTO };
	}
}

/* ------------------------------------------------------------------ *
 * Ritentativo
 * ------------------------------------------------------------------ */

/** Oltre tre giorni un avviso non è più una notizia: si smette di ritentarlo. */
export const GIORNI_RITENTATIVO = 3;

const GIORNO_MS = 86_400_000;

/**
 * Le email dovute e mai partite (ADR-0036).
 *
 * Serve al caso normale di un servizio che ogni tanto non risponde, e al caso
 * meno normale di una chiave scaduta che nessuno ha notato: le righe restano
 * lì, e la notte in cui la configurazione torna a posto partono tutte.
 *
 * Il taglio a tre giorni evita l'altro esito, quello in cui si sistema la
 * chiave dopo due settimane e quaranta persone ricevono in una volta gli
 * avvisi di quattordici giorni.
 */
export async function spedisciArretrate(db: Database, limite = 200): Promise<EsitoNotifica> {
	const soglia = new Date(Date.now() - GIORNI_RITENTATIVO * GIORNO_MS);

	try {
		const righe = await db
			.select({
				id: notifications.id,
				kind: notifications.kind,
				payload: notifications.payload,
				dedupeKey: notifications.dedupeKey,
				profileId: profiles.id,
				displayName: profiles.displayName,
				email: profiles.email
			})
			.from(notifications)
			.innerJoin(profiles, eq(profiles.id, notifications.profileId))
			.where(
				and(
					eq(notifications.emailRequested, true),
					isNull(notifications.emailedAt),
					gte(notifications.createdAt, soglia)
				)
			)
			.orderBy(desc(notifications.createdAt))
			.limit(limite);

		if (!righe.length) return { ...VUOTO };

		const daSpedire: RigaDaSpedire[] = righe.map((r) => {
			const contenuto = leggiContenuto(r.payload);
			const destinatario: Destinatario = {
				profileId: r.profileId,
				displayName: r.displayName,
				email: r.email
			};
			return {
				id: r.id,
				avviso: {
					kind: r.kind,
					destinatario,
					titolo: contenuto.titolo,
					testo: contenuto.testo,
					url: contenuto.url,
					dedupeKey: r.dedupeKey
				}
			};
		});

		const [emailSpedite, emailFallite] = await consegnaEmail(db, daSpedire);
		return { registrate: 0, ripetuti: 0, emailSpedite, emailFallite };
	} catch (err) {
		console.error('Ritentativo delle email arretrate non riuscito:', err);
		return { ...VUOTO };
	}
}

/**
 * Le righe troppo vecchie per essere ancora utili.
 *
 * Le notifiche non hanno la stessa urgenza di scadenza di `parse_jobs`
 * (ADR-0032) — sono testo che il destinatario poteva già vedere — ma una
 * casella che cresce all'infinito è comunque una casella che nessuno apre.
 * Sei mesi, e solo ciò che è già stato letto o che nessuno leggerà più.
 */
export const GIORNI_CONSERVAZIONE_NOTIFICHE = 180;

export async function scadiNotifiche(db: Database): Promise<{ cancellate: number }> {
	const soglia = new Date(Date.now() - GIORNI_CONSERVAZIONE_NOTIFICHE * GIORNO_MS);
	const righe = await db
		.delete(notifications)
		.where(lt(notifications.createdAt, soglia))
		.returning({ id: notifications.id });
	return { cancellate: righe.length };
}
