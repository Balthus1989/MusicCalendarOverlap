/**
 * Letture dei conflitti, per la dashboard e per l'avviso in pagina evento.
 *
 * Come per gli eventi, il filtro di visibilità è in due strati: qui si
 * restringe già in SQL ai conflitti che toccano un'organizzazione del viewer,
 * e `serializeConflict` fa il secondo passaggio, quello che decide **cosa** se
 * ne racconta (ADR-0024).
 *
 * Nessuna funzione di questo file restituisce righe grezze.
 */
import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '$lib/server/db/client';
import { artists, conflicts, events, type ConflictStatus } from '$lib/server/db/schema';
import { CON_RELAZIONI, mappaEvento } from '$lib/server/events/queries';
import {
	serializeConflicts,
	type ConflittoGrezzo,
	type ConflittoSerializzato,
	type ViewerContext
} from '$lib/server/visibility';
import type { ArtistaCondiviso, DettagliConflitto } from './rules';

/** Ciò che compare in dashboard senza doverlo chiedere. */
export const STATI_DA_TRATTARE: readonly ConflictStatus[] = ['open', 'acknowledged'];

/** Il resto: chiuso, ma consultabile. La storia serve (ADR-0009). */
export const STATI_ARCHIVIATI: readonly ConflictStatus[] = ['resolved', 'dismissed'];

/**
 * Conflitti che toccano una delle organizzazioni del viewer.
 *
 * La sottoquery sugli eventi evita di far viaggiare in memoria l'elenco degli
 * id di tutte le date proprie solo per rimetterlo dentro un `IN`.
 *
 * **La sottoquery si costruisce due volte, e non è uno spreco.** Passando lo
 * *stesso* costruttore a entrambi gli `inArray`, la query prodotta arriva a
 * Postgres con una sequenza di parametri che non corrisponde al testo: il
 * server la analizza, si mette in attesa del resto del dialogo e non lo riceve
 * mai. Dal lato database si vede una sessione `active` ferma su
 * `wait_event = ClientRead`, che con `max: 1` blocca la sola connessione
 * disponibile e fa morire in coda, dopo il `statement_timeout`, la prima query
 * innocente che capita — di solito quella su `profiles` in `ensureProfile`.
 *
 * Due costruttori distinti producono due sottoquery indipendenti e il dialogo
 * resta allineato. Costa una manciata di oggetti in memoria.
 */
function filtroDiAppartenenza(viewer: ViewerContext, db: Database): SQL | undefined {
	if (!viewer.organizationIds.length) return undefined;

	const mieiEventi = () =>
		db
			.select({ id: events.id })
			.from(events)
			.where(inArray(events.organizationId, viewer.organizationIds));

	return or(inArray(conflicts.eventAId, mieiEventi()), inArray(conflicts.eventBId, mieiEventi()));
}

const CON_LE_DUE_DATE = {
	eventA: { with: CON_RELAZIONI },
	eventB: { with: CON_RELAZIONI }
} as const;

/**
 * Ordina prima ciò che è più probabile sia un problema vero, poi il più
 * imminente. Un `low` fra sei mesi non deve stare sopra un `high` di sabato.
 */
const ORDINE = [
	sql`case ${conflicts.severity} when 'high' then 0 when 'medium' then 1 else 2 end`,
	sql`case ${conflicts.status} when 'open' then 0 else 1 end`,
	desc(conflicts.updatedAt)
];

type RigaConflitto = {
	id: string;
	eventAId: string;
	eventBId: string;
	kind: ConflittoGrezzo['kind'];
	severity: ConflittoGrezzo['severity'];
	status: ConflictStatus;
	distanceKm: string | null;
	genreAffinity: string | null;
	daysApart: number | null;
	details: unknown;
	acknowledgedByA: boolean;
	acknowledgedByB: boolean;
	resolutionNote: string | null;
	computedAt: Date;
	updatedAt: Date;
	eventA: Parameters<typeof mappaEvento>[0];
	eventB: Parameters<typeof mappaEvento>[0];
};

function aConflittoGrezzo(r: RigaConflitto): ConflittoGrezzo {
	return {
		id: r.id,
		eventAId: r.eventAId,
		eventBId: r.eventBId,
		kind: r.kind,
		severity: r.severity,
		status: r.status,
		distanceKm: r.distanceKm,
		genreAffinity: r.genreAffinity,
		daysApart: r.daysApart,
		details: (r.details ?? null) as DettagliConflitto | null,
		acknowledgedByA: r.acknowledgedByA,
		acknowledgedByB: r.acknowledgedByB,
		resolutionNote: r.resolutionNote,
		computedAt: r.computedAt,
		updatedAt: r.updatedAt
	};
}

/**
 * I nomi delle band citate dai conflitti.
 *
 * Si risolvono al momento della lettura invece di congelarli in `details`:
 * una scheda corretta da un moderatore (ADR-0016) deve comparire corretta
 * anche negli avvisi già registrati.
 */
async function nomiDegliArtisti(db: Database, righe: ConflittoGrezzo[]) {
	const ids = new Set<string>();
	for (const c of righe) {
		for (const a of (c.details?.artisti ?? []) as ArtistaCondiviso[]) ids.add(a.artistId);
	}
	if (!ids.size) return {};

	const trovati = await db
		.select({ id: artists.id, name: artists.name })
		.from(artists)
		.where(inArray(artists.id, [...ids]));

	return Object.fromEntries(trovati.map((a) => [a.id, a.name]));
}

async function serializzaRighe(
	db: Database,
	righe: RigaConflitto[],
	viewer: ViewerContext
): Promise<ConflittoSerializzato[]> {
	const grezzi = righe.map(aConflittoGrezzo);
	const nomi = await nomiDegliArtisti(db, grezzi);

	return serializeConflicts(
		righe.map((r, i) => ({
			conflitto: grezzi[i],
			a: mappaEvento(r.eventA),
			b: mappaEvento(r.eventB)
		})),
		viewer,
		nomi
	);
}

export type FiltriConflitti = {
	stati?: readonly ConflictStatus[];
	/** Solo i conflitti che toccano questa data. */
	eventId?: string;
};

/** I conflitti del viewer, già redatti secondo ciò che può sapere. */
export async function elencaConflitti(
	db: Database,
	viewer: ViewerContext,
	filtri: FiltriConflitti = {}
): Promise<ConflittoSerializzato[]> {
	if (!viewer.organizationIds.length) return [];

	const condizioni: (SQL | undefined)[] = [
		filtroDiAppartenenza(viewer, db),
		inArray(conflicts.status, [...(filtri.stati ?? STATI_DA_TRATTARE)])
	];

	if (filtri.eventId) {
		condizioni.push(
			or(eq(conflicts.eventAId, filtri.eventId), eq(conflicts.eventBId, filtri.eventId))
		);
	}

	const righe = await db.query.conflicts.findMany({
		where: and(...condizioni.filter((c): c is SQL => c !== undefined)),
		with: CON_LE_DUE_DATE,
		orderBy: ORDINE,
		limit: 200
	});

	return serializzaRighe(db, righe as unknown as RigaConflitto[], viewer);
}

/**
 * I conflitti aperti di una singola data.
 *
 * Serve alla pagina dell'evento, dove l'avviso deve essere impossibile da non
 * vedere prima di confermare: ADR-0022 non mette nessun cancello davanti alla
 * conferma, e in cambio pretende che chi conferma abbia visto il conflitto.
 */
export async function conflittiDellEvento(
	db: Database,
	viewer: ViewerContext,
	eventId: string
): Promise<ConflittoSerializzato[]> {
	return elencaConflitti(db, viewer, { eventId });
}

/**
 * Quanti conflitti da trattare ha il viewer, per il segnalino in navigazione.
 *
 * Il conteggio è **prima** della serializzazione, quindi può risultare più
 * alto di quanti se ne vedranno in dashboard: un `artist_overlap` su una band
 * che la controparte non ha annunciato esiste nel database ma non si racconta
 * a questo viewer (ADR-0024). Contarli dopo la redazione costerebbe caricare
 * ogni volta tutte le due date con tutte le relazioni, per un numero accanto
 * a una voce di menu.
 *
 * Il numero è quindi una soglia superiore, ed è questo il motivo per cui la
 * voce di menu mostra un pallino e non una cifra.
 */
export async function haConflittiDaTrattare(db: Database, viewer: ViewerContext): Promise<boolean> {
	if (!viewer.organizationIds.length) return false;

	const righe = await db
		.select({ id: conflicts.id })
		.from(conflicts)
		.where(and(filtroDiAppartenenza(viewer, db), inArray(conflicts.status, [...STATI_DA_TRATTARE])))
		.limit(1);

	return righe.length > 0;
}
