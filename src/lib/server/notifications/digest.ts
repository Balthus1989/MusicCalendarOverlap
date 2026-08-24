/**
 * Il riepilogo del lunedì mattina (§10, riga 4).
 *
 * Tre elenchi: le date nuove della settimana, i conflitti ancora da trattare,
 * le proprie opzioni con l'annuncio in scadenza. Tutti e tre passano dai
 * serializzatori, quindi il digest di ciascuno contiene esattamente ciò che
 * quel destinatario avrebbe visto aprendo il calendario — mai una riga in più.
 *
 * **I destinatari si raggruppano per insieme di organizzazioni, non per
 * persona.** La visibilità dipende solo dall'appartenenza (§5): due membri
 * dello stesso circolo hanno per costruzione lo stesso digest, e calcolarlo
 * due volte sarebbe lavoro identico ripetuto. Con venti organizzazioni la
 * differenza non si vede; la ragione per cui è scritto così è che con
 * l'insieme sbagliato di gruppi il testo sarebbe *sbagliato*, non solo lento,
 * e raggruppare per la chiave giusta lo rende evidente.
 */
import { and, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import type { Database } from '$lib/server/db/client';
import { events, memberships, profiles } from '$lib/server/db/schema';
import { elencaConflitti } from '$lib/server/conflicts/queries';
import { caricaEventi } from '$lib/server/events/queries';
import {
	serializeEvent,
	titoloVisibile,
	type EventoCompleto,
	type EventoSerializzato,
	type ViewerContext
} from '$lib/server/visibility';
import { giornoCivile } from '$lib/time';
import { titoloConflitto } from '$lib/conflicts';
import { avvisoDigest, type RiepilogoDigest, type VoceDigest } from './messages';
import type { Avviso, Destinatario } from './types';

const GIORNO_MS = 86_400_000;

/** La finestra all'indietro delle "date nuove": una settimana, come la cadenza. */
export const GIORNI_NOVITA = 7;

/** Quanto avanti guardare per le proprie opzioni in scadenza di annuncio. */
export const GIORNI_SCADENZA_ANNUNCIO = 14;

/**
 * L'etichetta della settimana, `2026-W35`.
 *
 * Entra nella chiave di deduplica: garantisce un digest a settimana anche se
 * la corsa del lunedì viene rilanciata a mano dopo un errore. Si calcola sul
 * lunedì della settimana corrente in ora italiana, che è il giorno in cui il
 * digest esce.
 */
export function etichettaSettimana(adesso: Date): string {
	const giorno = giornoCivile(adesso);
	const d = new Date(`${giorno}T00:00:00Z`);
	// ISO 8601: la settimana appartiene all'anno del suo giovedì.
	const giovedi = new Date(d);
	giovedi.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
	const primoGennaio = new Date(Date.UTC(giovedi.getUTCFullYear(), 0, 1));
	const numero = Math.ceil(((giovedi.getTime() - primoGennaio.getTime()) / GIORNO_MS + 1) / 7);
	return `${giovedi.getUTCFullYear()}-W${String(numero).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ *
 * Raccolta
 * ------------------------------------------------------------------ */

type Gruppo = {
	viewer: ViewerContext;
	destinatari: Destinatario[];
};

/** Gli iscritti raggruppati per insieme di organizzazioni. */
async function gruppiDiVisibilita(db: Database): Promise<Gruppo[]> {
	const righe = await db
		.select({
			profileId: profiles.id,
			displayName: profiles.displayName,
			email: profiles.email,
			organizationId: memberships.organizationId
		})
		.from(memberships)
		.innerJoin(profiles, eq(profiles.id, memberships.profileId));

	const perProfilo = new Map<string, { dest: Destinatario; orgs: string[] }>();
	for (const r of righe) {
		const voce = perProfilo.get(r.profileId) ?? {
			dest: { profileId: r.profileId, displayName: r.displayName, email: r.email },
			orgs: []
		};
		voce.orgs.push(r.organizationId);
		perProfilo.set(r.profileId, voce);
	}

	const gruppi = new Map<string, Gruppo>();
	for (const { dest, orgs } of perProfilo.values()) {
		const ordinate = [...orgs].sort();
		const chiave = ordinate.join('|');
		const gruppo = gruppi.get(chiave) ?? {
			viewer: {
				profileId: '',
				organizationIds: ordinate,
				roles: {},
				isPlatformAdmin: false
			},
			destinatari: []
		};
		gruppo.destinatari.push(dest);
		gruppi.set(chiave, gruppo);
	}

	return [...gruppi.values()];
}

/**
 * Le date inserite nell'ultima settimana e ancora da venire.
 *
 * Si caricano una volta sola per tutti i gruppi e si serializzano per
 * ciascuno: è la serializzazione a decidere chi vede cosa, e una bozza altrui
 * sparisce da sé restituendo `null`.
 */
async function dateNuove(db: Database, adesso: Date) {
	const daQuando = new Date(adesso.getTime() - GIORNI_NOVITA * GIORNO_MS);

	const righe = await db
		.select({ id: events.id })
		.from(events)
		.where(and(gte(events.createdAt, daQuando), gte(events.startsAt, adesso)))
		.limit(200);

	return caricaEventi(
		db,
		righe.map((r) => r.id)
	);
}

/** Le proprie date opzionate con l'annuncio scaduto o in scadenza. */
async function holdInScadenza(
	db: Database,
	organizationIds: string[],
	adesso: Date
): Promise<VoceDigest[]> {
	if (!organizationIds.length) return [];
	const entro = new Date(adesso.getTime() + GIORNI_SCADENZA_ANNUNCIO * GIORNO_MS);

	const righe = await db
		.select({ id: events.id })
		.from(events)
		.where(
			and(
				inArray(events.organizationId, organizationIds),
				eq(events.status, 'hold'),
				isNotNull(events.announceAt),
				lte(events.announceAt, entro),
				gte(events.startsAt, adesso)
			)
		)
		.limit(50);

	const eventi = await caricaEventi(
		db,
		righe.map((r) => r.id)
	);

	const viewer: ViewerContext = {
		profileId: '',
		organizationIds,
		roles: {},
		isPlatformAdmin: false
	};

	return eventi
		.map((e) => serializeEvent(e, viewer))
		.filter((e): e is EventoCompleto => e !== null && e.visibilita === 'completa')
		.map((e) => ({ giorno: e.giorno, testo: `${titoloVisibile(e)} — ancora opzionata` }));
}

/* ------------------------------------------------------------------ *
 * Costruzione
 * ------------------------------------------------------------------ */

/**
 * Gli avvisi di digest per tutti gli iscritti.
 *
 * Chi non ha niente da leggere non riceve niente: `avvisoDigest` restituisce
 * `null` sul riepilogo vuoto, e un'email settimanale che arriva anche quando
 * non è successo nulla insegna a non aprirla.
 */
export async function avvisiDigest(db: Database, adesso = new Date()): Promise<Avviso[]> {
	const gruppi = await gruppiDiVisibilita(db);
	if (!gruppi.length) return [];

	const settimana = etichettaSettimana(adesso);
	const nuove = await dateNuove(db, adesso);

	const avvisi: Avviso[] = [];

	for (const gruppo of gruppi) {
		const proprie = new Set(gruppo.viewer.organizationIds);

		const nuoveDate: VoceDigest[] = nuove
			.map((e) => serializeEvent(e, gruppo.viewer))
			// Le proprie date restano fuori: chi le ha inserite le conosce, e
			// un riepilogo che gli racconta il proprio lavoro è la via più
			// rapida per farlo smettere di leggere.
			.filter((e): e is EventoSerializzato => e !== null && !proprie.has(e.organizzazione.id))
			.map((e) => ({ giorno: e.giorno, testo: `${titoloVisibile(e)} — ${e.city}` }));

		const conflitti = await elencaConflitti(db, gruppo.viewer);
		const conflittiAperti: VoceDigest[] = conflitti.map((c) => ({
			giorno: c.mia.giorno,
			testo: `${titoloConflitto({
				kind: c.kind,
				severity: c.severity,
				distanzaKm: c.distanzaKm,
				giorniDiDistanza: c.giorniDiDistanza,
				controparte: {
					giorno: c.controparte.giorno,
					city: c.controparte.city,
					organizzazione: c.controparte.organizzazione
				},
				artisti: c.artisti,
				venue: c.venue
			})} (${c.mia.title})`
		}));

		const scadenze = await holdInScadenza(db, gruppo.viewer.organizationIds, adesso);

		const riepilogo: RiepilogoDigest = {
			nuoveDate,
			conflittiAperti,
			holdInScadenza: scadenze
		};

		for (const destinatario of gruppo.destinatari) {
			const avviso = avvisoDigest(riepilogo, destinatario, settimana);
			if (avviso) avvisi.push(avviso);
		}
	}

	return avvisi;
}
