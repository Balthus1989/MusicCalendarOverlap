/**
 * Letture degli eventi.
 *
 * Le query filtrano **già in SQL** ciò che il viewer non può vedere
 * (ARCHITECTURE.md §5): `serializeEvent` è il secondo strato, non il primo.
 * Due strati per la stessa regola non sono una ridondanza: il filtro SQL
 * evita di far viaggiare dati inutili, il serializzatore garantisce che una
 * query dimenticata non diventi un leak.
 *
 * Nessuna funzione di questo file restituisce righe già serializzate: la
 * serializzazione tocca a chi conosce il viewer, cioè alla rotta.
 */
import { and, asc, eq, gte, inArray, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '$lib/server/db/client';
import {
	artists,
	eventGenres,
	events,
	genres,
	organizations,
	venues,
	type EventStatus
} from '$lib/server/db/schema';
import { boundingBox, entroRaggio, type Punto } from '$lib/server/conflicts/geo';
import type { EventWithRelations, ViewerContext } from '$lib/server/visibility';

/* ------------------------------------------------------------------ *
 * Forma delle righe lette
 * ------------------------------------------------------------------ */

/**
 * Le relazioni che `serializeEvent` pretende. Esportata perché la dashboard
 * dei conflitti carica gli eventi delle due parti dalla stessa forma: due
 * definizioni divergerebbero, e la seconda a divergere passerebbe al
 * serializzatore un evento senza generi.
 */
export const CON_RELAZIONI = {
	organization: {
		columns: {
			id: true,
			name: true,
			slug: true,
			city: true,
			province: true,
			emailContact: true,
			website: true,
			instagramUrl: true,
			facebookUrl: true
		}
	},
	venue: {
		columns: {
			id: true,
			name: true,
			address: true,
			city: true,
			province: true,
			lat: true,
			lon: true,
			capacity: true
		}
	},
	eventGenres: {
		with: { genre: { columns: { slug: true, name: true, path: true } } }
	},
	lineup: {
		with: { artist: { columns: { id: true, name: true } } }
	},
	links: true
} as const;

/**
 * Unico punto in cui si legge un evento con le sue relazioni. Il tipo delle
 * righe si deduce da qui invece di essere riscritto a mano: se un giorno il
 * `with` cambia, il compilatore trova subito ogni punto da aggiornare.
 */
function trovaConRelazioni(db: Database, where: SQL | undefined, opzioni: { limit?: number } = {}) {
	return db.query.events.findMany({
		where,
		with: CON_RELAZIONI,
		orderBy: asc(events.startsAt),
		...opzioni
	});
}

type RigaGrezza = Awaited<ReturnType<typeof trovaConRelazioni>>[number];

/**
 * Dalla riga del database alla forma che `serializeEvent` si aspetta.
 *
 * Qui si risolve il nome della band: dall'anagrafica se collegata, dal testo
 * libero altrimenti. Chi legge la lineup non deve preoccuparsi di quale dei
 * due casi sia (ADR-0006).
 */
export function mappaEvento(r: RigaGrezza): EventWithRelations {
	return {
		id: r.id,
		organizationId: r.organizationId,
		venueId: r.venueId,
		status: r.status,
		title: r.title,
		subtitle: r.subtitle,
		description: r.description,
		startsAt: r.startsAt,
		endsAt: r.endsAt,
		doorsAt: r.doorsAt,
		isMultiDay: r.isMultiDay,
		city: r.city,
		province: r.province,
		region: r.region,
		country: r.country,
		lat: r.lat,
		lon: r.lon,
		conflictRadiusKm: r.conflictRadiusKm,
		isFree: r.isFree,
		isMembersOnly: r.isMembersOnly,
		pricePresale: r.pricePresale,
		priceDoor: r.priceDoor,
		currency: r.currency,
		ticketUrl: r.ticketUrl,
		ageRestriction: r.ageRestriction,
		capacityExpected: r.capacityExpected,
		posterUrl: r.posterUrl,
		facebookEventUrl: r.facebookEventUrl,
		instagramPostUrl: r.instagramPostUrl,
		externalUrl: r.externalUrl,
		announceAt: r.announceAt,
		internalNotes: r.internalNotes,
		updatedAt: r.updatedAt,
		organization: r.organization,
		venue: r.venue,
		genres: r.eventGenres
			.map((eg) => ({
				slug: eg.genre.slug,
				name: eg.genre.name,
				path: eg.genre.path,
				isPrimary: eg.isPrimary
			}))
			// Il primario per primo: chi legge si aspetta quell'ordine, e
			// `titoloVisibile` ci si appoggia.
			.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name)),
		lineup: [...r.lineup]
			.sort((a, b) => a.position - b.position)
			.map((v) => ({
				id: v.id,
				artistId: v.artistId,
				nome: v.artist?.name ?? v.artistNameRaw ?? 'TBA',
				billing: v.billing,
				position: v.position,
				stage: v.stage,
				dayDate: v.dayDate,
				setStartsAt: v.setStartsAt,
				setDurationMinutes: v.setDurationMinutes,
				isAnnounced: v.isAnnounced
			})),
		links: [...r.links]
			.sort((a, b) => a.sortOrder - b.sortOrder)
			.map((l) => ({ label: l.label, url: l.url }))
	};
}

/* ------------------------------------------------------------------ *
 * Filtro di visibilità
 * ------------------------------------------------------------------ */

/**
 * Le bozze altrui non escono dal database.
 *
 * `serializeEvent` le scarterebbe comunque, ma farle viaggiare fin lì
 * significherebbe tenere il titolo di una serata segreta nella memoria di un
 * processo che serve una richiesta di un'altra organizzazione. Non serve.
 */
function filtroVisibilita(viewer: ViewerContext): SQL | undefined {
	if (viewer.organizationIds.length === 0) return ne(events.status, 'draft');
	return or(ne(events.status, 'draft'), inArray(events.organizationId, viewer.organizationIds));
}

/* ------------------------------------------------------------------ *
 * Letture
 * ------------------------------------------------------------------ */

export type FiltriCalendario = {
	/** Finestra temporale, sugli istanti di inizio. */
	da: Date;
	a: Date;
	statuses?: EventStatus[];
	organizationIds?: string[];
	/**
	 * Slug di genere. Il filtro include i sottogeneri: chi cerca "metal"
	 * vuole anche il death metal, altrimenti la tassonomia gerarchica non
	 * servirebbe a niente (ADR-0007).
	 */
	genreSlugs?: string[];
	/** Filtro "entro N km da qui". Senza centro, il raggio viene ignorato. */
	centro?: Punto | null;
	raggioKm?: number | null;
};

/** Id degli eventi che hanno almeno uno dei generi richiesti, sottogeneri inclusi. */
async function idsPerGenere(db: Database, slugs: string[]): Promise<string[]> {
	const radici = await db
		.select({ path: genres.path })
		.from(genres)
		.where(inArray(genres.slug, slugs));

	if (!radici.length) return [];

	// `path = 'metal' OR path LIKE 'metal.%'`: il `LIKE` da solo prenderebbe
	// anche `metalcore`, che è un genere a sé (vedi `genres/path.ts`).
	const condizioni = radici.map((r) =>
		or(eq(genres.path, r.path), sql`${genres.path} like ${r.path + '.%'}`)
	);

	const righe = await db
		.selectDistinct({ eventId: eventGenres.eventId })
		.from(eventGenres)
		.innerJoin(genres, eq(genres.id, eventGenres.genreId))
		.where(or(...condizioni));

	return righe.map((r) => r.eventId);
}

/**
 * Eventi visibili al viewer in una finestra temporale.
 *
 * Il filtro geografico è in due tempi (ADR-0008): bounding box in SQL, dove
 * c'è l'indice su `(lat, lon)`, e haversine in codice sul poco che resta.
 */
export async function elencaEventi(
	db: Database,
	viewer: ViewerContext,
	filtri: FiltriCalendario
): Promise<EventWithRelations[]> {
	const condizioni: (SQL | undefined)[] = [
		filtroVisibilita(viewer),
		gte(events.startsAt, filtri.da),
		lte(events.startsAt, filtri.a)
	];

	if (filtri.statuses?.length) condizioni.push(inArray(events.status, filtri.statuses));
	if (filtri.organizationIds?.length) {
		condizioni.push(inArray(events.organizationId, filtri.organizationIds));
	}

	if (filtri.genreSlugs?.length) {
		const ids = await idsPerGenere(db, filtri.genreSlugs);
		// Nessun evento con quel genere: si esce subito invece di costruire un
		// `IN ()` vuoto, che in SQL non è valido.
		if (!ids.length) return [];
		condizioni.push(inArray(events.id, ids));
	}

	const raggio = filtri.raggioKm ?? null;
	if (filtri.centro && raggio) {
		const box = boundingBox(filtri.centro, raggio);
		condizioni.push(
			gte(events.lat, box.latMin),
			lte(events.lat, box.latMax),
			gte(events.lon, box.lonMin),
			lte(events.lon, box.lonMax)
		);
	}

	const righe = await trovaConRelazioni(
		db,
		and(...condizioni.filter((c): c is SQL => c !== undefined)),
		{ limit: 1000 }
	);

	const mappati = righe.map(mappaEvento);

	if (filtri.centro && raggio) {
		const centro = filtri.centro;
		return mappati.filter(
			(e) =>
				e.lat !== null && e.lon !== null && entroRaggio(centro, { lat: e.lat, lon: e.lon }, raggio)
		);
	}

	return mappati;
}

/** Un evento con tutte le sue relazioni. Non applica visibilità: la applica chi chiama. */
export async function caricaEvento(db: Database, id: string): Promise<EventWithRelations | null> {
	const righe = await trovaConRelazioni(db, eq(events.id, id), { limit: 1 });
	return righe[0] ? mappaEvento(righe[0]) : null;
}

/**
 * La riga grezza con i campi che servono al form di modifica.
 *
 * Deliberatamente separata da `caricaEvento`: il form di modifica lavora su
 * dati **propri**, quindi non passa dal serializzatore, ed è bene che si veda
 * dal nome della funzione quale delle due strade si sta prendendo.
 */
export async function caricaEventoPerModifica(db: Database, id: string) {
	const riga = await db.query.events.findFirst({
		where: eq(events.id, id),
		with: {
			eventGenres: { with: { genre: { columns: { slug: true } } } },
			lineup: { with: { artist: { columns: { id: true, name: true } } } },
			links: true
		}
	});
	if (!riga) return null;

	return {
		...riga,
		lineup: [...riga.lineup].sort((a, b) => a.position - b.position),
		links: [...riga.links].sort((a, b) => a.sortOrder - b.sortOrder)
	};
}

/** Le prossime date della propria organizzazione, per la home dell'app. */
export async function prossimiEventiDi(
	db: Database,
	organizationIds: string[],
	da: Date,
	limite = 10
): Promise<EventWithRelations[]> {
	if (!organizationIds.length) return [];
	const righe = await trovaConRelazioni(
		db,
		and(inArray(events.organizationId, organizationIds), gte(events.startsAt, da)),
		{ limit: limite }
	);
	return righe.map(mappaEvento);
}

/** Opzioni per i filtri del calendario: solo ciò che compare davvero negli eventi. */
export async function opzioniFiltri(db: Database) {
	const generi = await db
		.selectDistinct({ slug: genres.slug, name: genres.name, path: genres.path })
		.from(eventGenres)
		.innerJoin(genres, eq(genres.id, eventGenres.genreId))
		.orderBy(asc(genres.path));

	const orgs = await db
		.selectDistinct({ id: organizations.id, name: organizations.name })
		.from(events)
		.innerJoin(organizations, eq(organizations.id, events.organizationId))
		.orderBy(asc(organizations.name));

	return { generi, organizzazioni: orgs };
}

/** Venue e artisti servono al form: qui solo i riferimenti minimi. */
export async function opzioniForm(db: Database) {
	// Sequenziali e non in `Promise.all`: sono due letture piccole su un form
	// che si apre di rado, e in cambio un errore o una lentezza si
	// attribuiscono alla query giusta.
	const locali = await db
		.select({
			id: venues.id,
			name: venues.name,
			city: venues.city,
			province: venues.province,
			lat: venues.lat,
			lon: venues.lon
		})
		.from(venues)
		.orderBy(asc(venues.city), asc(venues.name))
		.limit(500);

	const generiTutti = await db
		.select({ slug: genres.slug, name: genres.name, path: genres.path, depth: genres.depth })
		.from(genres)
		.orderBy(asc(genres.path));

	return { locali, generi: generiTutti };
}

/** Artisti già in lineup, per ricostruire i nomi nel form dopo un errore di validazione. */
export async function nomiArtisti(db: Database, ids: string[]): Promise<Record<string, string>> {
	if (!ids.length) return {};
	const righe = await db
		.select({ id: artists.id, name: artists.name })
		.from(artists)
		.where(inArray(artists.id, ids));
	return Object.fromEntries(righe.map((r) => [r.id, r.name]));
}

/**
 * Più eventi con le loro relazioni, per id.
 *
 * Serve all'anteprima dei conflitti: il motore lavora su una forma leggera,
 * ma per mostrare la controparte di un conflitto serve un evento completo da
 * passare a `serializeEvent`. Si caricano solo quelli che un conflitto lo
 * hanno davvero, che sono pochi.
 */
export async function caricaEventi(db: Database, ids: string[]): Promise<EventWithRelations[]> {
	if (!ids.length) return [];
	const righe = await trovaConRelazioni(db, inArray(events.id, ids), { limit: ids.length });
	return righe.map(mappaEvento);
}
