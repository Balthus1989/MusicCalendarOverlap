/**
 * Riconciliazione dei conflitti (ARCHITECTURE.md §6.1 e §6.4).
 *
 * È l'unico file di `conflicts/` che tocca il database. Fa tre cose:
 * seleziona i candidati con cui una data potrebbe scontrarsi, chiede al
 * motore puro quali conflitti esistono davvero, e allinea la tabella
 * `conflicts` al risultato.
 *
 * Il verbo è "riconciliare" e non "inserire" perché i conflitti spariti non si
 * cancellano: passano a `resolved` con una nota automatica. Senza storico,
 * l'avviso che due organizzatori hanno già chiarito al telefono
 * riapparirebbe in eterno (ADR-0009).
 */
import { and, asc, between, eq, gte, inArray, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import type { Database } from '$lib/server/db/client';
import {
	conflicts,
	events,
	type ConflictSeverity,
	type ConflictStatus,
	type EventStatus
} from '$lib/server/db/schema';
import { daLocaleAIstante, giornoCivile } from '$lib/time';
import { rilevaConflitti, type ConflittoTrovato } from './engine';
import { boundingBox } from './geo';
import type { EventoPerConflitti } from './rules';

/**
 * Solo `hold` e `confirmed` entrano nel motore, da entrambi i lati.
 *
 * Una bozza non partecipa perché nessun altro sa che esiste: persistere un
 * conflitto con una bozza significherebbe avvisare un'organizzazione di una
 * data che non ha il diritto di vedere — cioè bucare ADR-0005 dal lato meno
 * sorvegliato. Una data annullata non partecipa perché non si contende più
 * niente: ha liberato lo slot, che è tutto il contrario di un conflitto.
 */
export const STATI_IN_CONFLITTO: readonly EventStatus[] = ['hold', 'confirmed'];

export function partecipaAiConflitti(stato: EventStatus): boolean {
	return STATI_IN_CONFLITTO.includes(stato);
}

/**
 * Margine della finestra SQL oltre i sette giorni della regola R2 (ADR-0021).
 *
 * Tre giorni, e non zero, perché il confronto avviene su **giorni civili** in
 * `Europe/Rome` mentre il filtro SQL lavora su istanti: un concerto alle 23:30
 * del settimo giorno è ancora dentro la regola pur essendo quasi otto giorni
 * più in là in millisecondi.
 */
const MARGINE_GIORNI = 3;
const FINESTRA_CANDIDATI_GIORNI = 7 + MARGINE_GIORNI;
const GIORNO_MS = 86_400_000;

/**
 * Distanza massima oltre cui nessuna regola può scattare: è il limite di R2,
 * il più largo dei quattro. Serve al prefiltro con bounding box, che fa
 * scartare al database la gran parte delle righe prima dell'haversine
 * (ADR-0008).
 */
const RAGGIO_MASSIMO_KM = 200;

/* ------------------------------------------------------------------ *
 * Lettura
 * ------------------------------------------------------------------ */

const CON_DATI_CONFLITTO = {
	organization: { columns: { id: true, defaultConflictRadiusKm: true } },
	eventGenres: { with: { genre: { columns: { path: true } } } },
	lineup: { columns: { artistId: true, isAnnounced: true } }
} as const;

type RigaConflitto = {
	id: string;
	organizationId: string;
	venueId: string | null;
	status: EventStatus;
	startsAt: Date;
	endsAt: Date | null;
	doorsAt: Date | null;
	lat: number | null;
	lon: number | null;
	conflictRadiusKm: number | null;
	organization: { id: string; defaultConflictRadiusKm: number };
	eventGenres: { isPrimary: boolean; genre: { path: string } }[];
	lineup: { artistId: string | null; isAnnounced: boolean }[];
};

export type EventoCaricato = EventoPerConflitti & { status: EventStatus };

/**
 * Dalla riga letta alla forma che il motore si aspetta.
 *
 * Qui si risolve il raggio effettivo — override dell'evento, altrimenti
 * predefinito dell'organizzazione — così il motore non deve sapere che le
 * organizzazioni esistono.
 */
function aEventoPerConflitti(r: RigaConflitto): EventoCaricato {
	return {
		id: r.id,
		organizationId: r.organizationId,
		venueId: r.venueId,
		status: r.status,
		startsAt: r.startsAt,
		endsAt: r.endsAt,
		doorsAt: r.doorsAt,
		lat: r.lat,
		lon: r.lon,
		raggioKm: r.conflictRadiusKm ?? r.organization.defaultConflictRadiusKm,
		generi: r.eventGenres.map((eg) => ({ path: eg.genre.path, isPrimary: eg.isPrimary })),
		// Una voce senza `artist_id` non è confrontabile: "Death SS" scritto a
		// mano da due organizzatori diversi non è la stessa band finché
		// qualcuno non la collega all'anagrafica (ADR-0006).
		lineup: r.lineup
			.filter((v): v is { artistId: string; isAnnounced: boolean } => v.artistId !== null)
			.map((v) => ({ artistId: v.artistId, isAnnounced: v.isAnnounced }))
	};
}

/** Un evento con tutto ciò che serve al motore, o `null` se non esiste. */
export async function caricaPerConflitti(
	db: Database,
	eventId: string
): Promise<EventoCaricato | null> {
	const riga = await db.query.events.findFirst({
		where: eq(events.id, eventId),
		with: CON_DATI_CONFLITTO
	});
	return riga ? aEventoPerConflitti(riga as RigaConflitto) : null;
}

/**
 * I candidati con cui una data può entrare in conflitto (§6.1).
 *
 * La finestra temporale è ±10 giorni attorno al **giorno civile** della data,
 * non ±10 giorni dall'istante di inizio: è la stessa unità in cui ragiona la
 * regola R2, e mescolare le due sarebbe il modo più rapido di perdere un
 * conflitto al bordo.
 *
 * Il prefiltro geografico è largo di proposito: un falso positivo costa una
 * chiamata a `distanzaKm`, un falso negativo costa un conflitto non rilevato.
 * Gli eventi senza coordinate restano fuori — nessuna regola può scattare su
 * di loro, quindi caricarli sarebbe lavoro sprecato.
 */
export async function candidati(
	db: Database,
	evento: EventoPerConflitti
): Promise<EventoCaricato[]> {
	const giorno = giornoCivile(evento.startsAt);
	const inizioGiorno = daLocaleAIstante(`${giorno}T00:00`).getTime();
	const fineGiorno = inizioGiorno + GIORNO_MS;

	const da = new Date(inizioGiorno - FINESTRA_CANDIDATI_GIORNI * GIORNO_MS);
	const a = new Date(fineGiorno + FINESTRA_CANDIDATI_GIORNI * GIORNO_MS);

	const condizioni = [
		inArray(events.status, [...STATI_IN_CONFLITTO]),
		// La stessa organizzazione non entra mai in conflitto con sé stessa:
		// se un circolo mette due date la stessa sera, lo sa già.
		ne(events.organizationId, evento.organizationId),
		ne(events.id, evento.id),
		between(events.startsAt, da, a)
	];

	if (evento.lat !== null && evento.lon !== null) {
		const box = boundingBox({ lat: evento.lat, lon: evento.lon }, RAGGIO_MASSIMO_KM);
		condizioni.push(
			gte(events.lat, box.latMin),
			lte(events.lat, box.latMax),
			gte(events.lon, box.lonMin),
			lte(events.lon, box.lonMax)
		);
	}

	const righe = await db.query.events.findMany({
		where: and(...condizioni),
		with: CON_DATI_CONFLITTO,
		orderBy: asc(events.startsAt),
		limit: 500
	});

	return (righe as RigaConflitto[]).map(aEventoPerConflitti);
}

/* ------------------------------------------------------------------ *
 * Scrittura
 * ------------------------------------------------------------------ */

export const NOTA_RISOLUZIONE_AUTOMATICA =
	'Risolto dal ricalcolo: una delle due date è cambiata e le condizioni del conflitto non ci sono più.';

export type EsitoRiconciliazione = {
	eventId: string;
	/** Conflitti che prima non c'erano, o che erano stati risolti dal ricalcolo. */
	nuovi: ConflittoTrovato[];
	confermati: number;
	risolti: number;
};

const vuoto = (eventId: string): EsitoRiconciliazione => ({
	eventId,
	nuovi: [],
	confermati: 0,
	risolti: 0
});

/** Chiave di identità di un conflitto: la coppia ordinata più la regola. */
const chiaveDi = (c: { eventAId: string; eventBId: string; kind: string }) =>
	`${c.eventAId}|${c.eventBId}|${c.kind}`;

const testo = (v: number | null): string | null => (v === null ? null : String(v));

export type OpzioniRiconciliazione = {
	/**
	 * La data sta **entrando** in `hold` o `confirmed` da uno stato che non
	 * partecipava, oppure passa fra i due. In quel caso i conflitti chiusi come
	 * `resolved` tornano aperti anche se a chiuderli era stata una persona
	 * (ADR-0027).
	 *
	 * Chi chiama lo sa e lo dice: qui non si può dedurre, perché a questo punto
	 * la riga è già stata aggiornata e lo stato precedente non c'è più.
	 */
	rientroInCartellone?: boolean;
};

/**
 * Ricalcola i conflitti di una data e allinea la tabella.
 *
 * Va chiamata a ogni salvataggio e a ogni cambio di stato. Non solleva mai:
 * un errore nel ricalcolo non deve far perdere all'utente la data che aveva
 * appena inserito — la stessa scelta che si è fatta per il registro di audit.
 * Il ricalcolo notturno recupera comunque le derive (§6.4).
 */
export async function riconciliaConflitti(
	db: Database,
	eventId: string,
	opzioni: OpzioniRiconciliazione = {}
): Promise<EsitoRiconciliazione> {
	const evento = await caricaPerConflitti(db, eventId);
	if (!evento) return vuoto(eventId);

	// Una data che esce da `hold`/`confirmed` non si contende più niente: i
	// suoi conflitti aperti vanno chiusi, non lasciati a invecchiare in una
	// dashboard.
	const trovati = partecipaAiConflitti(evento.status)
		? rilevaConflitti(evento, await candidati(db, evento))
		: [];

	const esistenti = await db
		.select({
			id: conflicts.id,
			eventAId: conflicts.eventAId,
			eventBId: conflicts.eventBId,
			kind: conflicts.kind,
			status: conflicts.status,
			resolvedBy: conflicts.resolvedBy
		})
		.from(conflicts)
		.where(or(eq(conflicts.eventAId, eventId), eq(conflicts.eventBId, eventId)));

	const primaPerChiave = new Map(esistenti.map((c) => [chiaveDi(c), c]));

	/**
	 * "Nuovo" è ciò che merita di far scattare una notifica: un conflitto mai
	 * visto, oppure uno che era stato chiuso dal ricalcolo e che è tornato
	 * perché una data si è rimessa in mezzo. Un conflitto già `acknowledged`,
	 * `dismissed` o risolto **da una persona** non è nuovo: quei due si sono
	 * già parlati, e ripresentarglielo è il modo di far ignorare anche gli
	 * avvisi veri (ADR-0021).
	 */
	const nuovi = trovati.filter((c) => {
		const prima = primaPerChiave.get(chiaveDi(c));
		if (!prima) return true;
		if (prima.status !== 'resolved') return false;
		// Rientrando in cartellone torna una notizia anche ciò che aveva
		// chiuso una persona: la sua nota parlava di una situazione che nel
		// frattempo è cambiata due volte (ADR-0027).
		return prima.resolvedBy === null || (opzioni.rientroInCartellone ?? false);
	});

	const adesso = new Date();
	let risolti = 0;

	try {
		await db.transaction(async (tx) => {
			let idSalvati: string[] = [];

			if (trovati.length) {
				const salvati = await tx
					.insert(conflicts)
					.values(
						trovati.map((c) => ({
							eventAId: c.eventAId,
							eventBId: c.eventBId,
							kind: c.kind,
							severity: c.severity,
							distanceKm: testo(c.distanzaKm),
							genreAffinity: testo(c.affinita),
							daysApart: c.giorniDiDistanza,
							details: c.dettagli
						}))
					)
					.onConflictDoUpdate({
						target: [conflicts.eventAId, conflicts.eventBId, conflicts.kind],
						set: {
							severity: sql`excluded.severity`,
							distanceKm: sql`excluded.distance_km`,
							genreAffinity: sql`excluded.genre_affinity`,
							daysApart: sql`excluded.days_apart`,
							details: sql`excluded.details`,
							updatedAt: adesso,
							/**
							 * Quando un `resolved` torna aperto (ADR-0027):
							 *
							 * - se l'aveva chiuso **il ricalcolo**
							 *   (`resolved_by is null`), sempre: era sparito, è
							 *   tornato, è di nuovo una notizia;
							 * - se l'aveva chiuso **una persona**, solo quando
							 *   la data rientra in cartellone. La sua nota
							 *   descriveva una situazione che nel frattempo è
							 *   cambiata, e il rientro è il momento in cui va
							 *   riletta — confermare, in particolare, vuol dire
							 *   annunciare (ADR-0022).
							 *
							 * `dismissed` non si tocca mai: significa «lo
							 *  sappiamo e va bene così», ed è una decisione che
							 *  riguarda proprio il conflitto che continua a
							 *  esistere.
							 */
							status: sql`case
								when ${conflicts.status} = 'resolved'
									and (${conflicts.resolvedBy} is null or ${sql.raw(String(opzioni.rientroInCartellone ?? false))})
								then 'open'::conflict_status
								else ${conflicts.status}
							end`,
							// La nota di chi ha chiuso si conserva: riaperto il
							// conflitto, sapere come lo si era risolto la volta
							// prima è la cosa più utile che ci sia. Si butta
							// solo quella automatica, che non dice niente.
							resolutionNote: sql`case
								when ${conflicts.status} = 'resolved' and ${conflicts.resolvedBy} is null
								then null
								else ${conflicts.resolutionNote}
							end`,
							// Chi ha chiuso non è più chi lo tiene chiuso, e i
							// «preso atto» si riferivano alla situazione
							// precedente: entrambe le parti devono rivederlo.
							resolvedBy: sql`case
								when ${conflicts.status} = 'resolved' and ${sql.raw(String(opzioni.rientroInCartellone ?? false))}
								then null
								else ${conflicts.resolvedBy}
							end`,
							acknowledgedByA: sql`case
								when ${conflicts.status} = 'resolved' and ${sql.raw(String(opzioni.rientroInCartellone ?? false))}
								then false
								else ${conflicts.acknowledgedByA}
							end`,
							acknowledgedByB: sql`case
								when ${conflicts.status} = 'resolved' and ${sql.raw(String(opzioni.rientroInCartellone ?? false))}
								then false
								else ${conflicts.acknowledgedByB}
							end`
						}
					})
					.returning({ id: conflicts.id });

				idSalvati = salvati.map((s) => s.id);
			}

			const daChiudere = [
				or(eq(conflicts.eventAId, eventId), eq(conflicts.eventBId, eventId)),
				inArray(conflicts.status, ['open', 'acknowledged'] satisfies ConflictStatus[])
			];
			if (idSalvati.length) daChiudere.push(notInArray(conflicts.id, idSalvati));

			const chiusi = await tx
				.update(conflicts)
				.set({
					status: 'resolved',
					// `resolvedBy` resta `NULL`: è ciò che distingue questa
					// chiusura da quella scritta da una persona.
					resolutionNote: NOTA_RISOLUZIONE_AUTOMATICA,
					updatedAt: adesso
				})
				.where(and(...daChiudere))
				.returning({ id: conflicts.id });

			risolti = chiusi.length;
		});
	} catch (err) {
		// Come per l'audit: perdere un ricalcolo è spiacevole, perdere il
		// lavoro dell'utente no. Il cron notturno rimette a posto.
		console.error(`Ricalcolo dei conflitti non riuscito per l'evento ${eventId}:`, err);
		return vuoto(eventId);
	}

	return { eventId, nuovi, confermati: trovati.length - nuovi.length, risolti };
}

/**
 * Il filtro di severity per le notifiche vive in
 * `notifications/conflitti.ts`, insieme al resto della costruzione degli
 * avvisi: qui c'era una funzione `daNotificare` che dalla Fase 6 non serve
 * più, perché chi la chiamava avrebbe comunque dovuto ricaricare i conflitti
 * persistiti per poterli redigere.
 */

/* ------------------------------------------------------------------ *
 * Ricalcolo massivo
 * ------------------------------------------------------------------ */

export type EsitoRicalcolo = {
	eventiEsaminati: number;
	conflittiNuovi: number;
	conflittiRisolti: number;
};

/**
 * Ricalcola l'intera finestra futura (§6.4 punto 4).
 *
 * Serve a recuperare le derive: un ricalcolo fallito in silenzio, una riga
 * scritta a mano, una migrazione che ha cambiato i raggi predefiniti. Gira di
 * notte da GitHub Actions, quando nessuno lo guarda.
 *
 * Ogni evento viene riconciliato per intero, quindi ogni coppia viene
 * esaminata due volte: è lavoro sprecato per metà, ma su qualche centinaio di
 * date costa secondi, e la versione furba avrebbe bisogno di tenere traccia
 * delle coppie già viste per un guadagno che nessuno noterebbe.
 */
export async function ricalcolaFinestra(
	db: Database,
	da: Date,
	a: Date,
	/**
	 * Che cosa fare di ogni riconciliazione, oltre a contarla.
	 *
	 * Serve al layer di notifica: anche i conflitti che salta fuori la corsa
	 * notturna vanno annunciati, e sono anzi quelli che più facilmente
	 * nessuno ha visto arrivare — una scheda artista unita da un moderatore,
	 * un raggio predefinito cambiato. È un parametro e non un import perché
	 * questo file sta sotto `conflicts/` e non deve sapere che le notifiche
	 * esistono.
	 */
	perEsito?: (esito: EsitoRiconciliazione) => Promise<void>
): Promise<EsitoRicalcolo> {
	const daRicalcolare = await db
		.select({ id: events.id })
		.from(events)
		.where(and(inArray(events.status, [...STATI_IN_CONFLITTO]), between(events.startsAt, da, a)))
		.orderBy(asc(events.startsAt));

	let conflittiNuovi = 0;
	let conflittiRisolti = 0;

	for (const { id } of daRicalcolare) {
		const esito = await riconciliaConflitti(db, id);
		conflittiNuovi += esito.nuovi.length;
		conflittiRisolti += esito.risolti;
		if (perEsito) await perEsito(esito);
	}

	return { eventiEsaminati: daRicalcolare.length, conflittiNuovi, conflittiRisolti };
}

/** Severity in ordine decrescente, per le query che devono mostrare il peggio prima. */
export const ORDINE_SEVERITA_SQL = sql`case ${conflicts.severity}
	when 'high' then 0 when 'medium' then 1 else 2 end`;

export type { ConflictSeverity };
