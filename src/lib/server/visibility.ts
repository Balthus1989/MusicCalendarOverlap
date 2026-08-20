/**
 * Layer di serializzazione della visibilità (ARCHITECTURE.md §5, ADR-0005).
 *
 * Regola non negoziabile: **nessun handler restituisce mai una riga `events`
 * grezza al client.** Tutto passa da `serializeEvent()`.
 *
 * Il modello in una riga: un evento in `hold` visto da un'altra organizzazione
 * si presenta come _"12 ottobre — Perugia (PG) — Metal — Associazione X —
 * [contatta]"_. Abbastanza per far scattare la telefonata, non abbastanza per
 * bruciare un annuncio.
 *
 * Il file è codice puro: nessuna query, nessun `fetch`. Si testa cella per
 * cella contro la matrice di §5, ed è la suite più importante del progetto.
 */
import { giornoCivile } from '$lib/time';
import type { BillingRole, EventStatus, MemberRole } from '$lib/server/db/schema';

export type ViewerContext = {
	profileId: string;
	/**
	 * Organizzazioni di cui il profilo è membro. La matrice di visibilità
	 * distingue solo "mia" da "non mia": il ruolo non entra mai nel calcolo di
	 * cosa si vede, solo in quello di cosa si può modificare.
	 */
	organizationIds: string[];
	/** Ruolo per organizzazione, per i controlli in `auth/permissions.ts`. */
	roles: Record<string, MemberRole>;
	isPlatformAdmin: boolean;
};

/** Vero se il viewer appartiene all'organizzazione proprietaria della risorsa. */
export function ownsOrganization(viewer: ViewerContext, organizationId: string): boolean {
	return viewer.organizationIds.includes(organizationId);
}

/* ------------------------------------------------------------------ *
 * Ciò che entra
 * ------------------------------------------------------------------ */

export type OrganizzazioneEvento = {
	id: string;
	name: string;
	slug: string;
	city: string | null;
	province: string | null;
	emailContact: string | null;
	website: string | null;
	instagramUrl: string | null;
	facebookUrl: string | null;
};

export type VenueEvento = {
	id: string;
	name: string;
	address: string | null;
	city: string;
	province: string | null;
	lat: number;
	lon: number;
	capacity: number | null;
};

export type GenereEvento = {
	slug: string;
	name: string;
	path: string;
	isPrimary: boolean;
};

export type VoceLineup = {
	id: string;
	artistId: string | null;
	/** Nome risolto: dall'anagrafica se c'è, altrimenti il testo libero. */
	nome: string;
	billing: BillingRole;
	position: number;
	stage: string | null;
	dayDate: string | null;
	setStartsAt: Date | null;
	setDurationMinutes: number | null;
	isAnnounced: boolean;
};

export type LinkEvento = { label: string; url: string };

/** La riga `events` con le sue relazioni, così come esce dal database. */
export type EventWithRelations = {
	id: string;
	organizationId: string;
	venueId: string | null;
	status: EventStatus;
	title: string;
	subtitle: string | null;
	description: string | null;
	startsAt: Date;
	endsAt: Date | null;
	doorsAt: Date | null;
	isMultiDay: boolean;
	city: string;
	province: string | null;
	region: string | null;
	country: string;
	lat: number | null;
	lon: number | null;
	conflictRadiusKm: number | null;
	isFree: boolean;
	isMembersOnly: boolean;
	pricePresale: string | null;
	priceDoor: string | null;
	currency: string;
	ticketUrl: string | null;
	ageRestriction: string | null;
	capacityExpected: number | null;
	posterUrl: string | null;
	facebookEventUrl: string | null;
	instagramPostUrl: string | null;
	externalUrl: string | null;
	announceAt: Date | null;
	internalNotes: string | null;
	organization: OrganizzazioneEvento;
	venue: VenueEvento | null;
	genres: GenereEvento[];
	lineup: VoceLineup[];
	links: LinkEvento[];
};

/* ------------------------------------------------------------------ *
 * Ciò che esce
 * ------------------------------------------------------------------ */

type Base = {
	id: string;
	status: EventStatus;
	/** Vero se l'evento appartiene a un'organizzazione del viewer. */
	proprio: boolean;
	/** Giorno civile in `Europe/Rome`, `YYYY-MM-DD`. Sempre presente. */
	giorno: string;
	city: string;
	province: string | null;
	organizzazione: OrganizzazioneEvento;
};

/** Vista ridotta: è tutto ciò che un `hold` altrui lascia vedere. */
export type EventoRidotto = Base & {
	visibilita: 'ridotta';
	/** Solo il genere primario: i secondari raccontano troppo della serata. */
	generePrimario: GenereEvento | null;
};

/** Vista completa: `confirmed`/`cancelled` altrui, oppure qualunque cosa propria. */
export type EventoCompleto = Base & {
	visibilita: 'completa';
	title: string;
	subtitle: string | null;
	description: string | null;
	startsAt: Date;
	endsAt: Date | null;
	doorsAt: Date | null;
	isMultiDay: boolean;
	region: string | null;
	country: string;
	lat: number | null;
	lon: number | null;
	isFree: boolean;
	isMembersOnly: boolean;
	pricePresale: string | null;
	priceDoor: string | null;
	currency: string;
	ticketUrl: string | null;
	ageRestriction: string | null;
	capacityExpected: number | null;
	posterUrl: string | null;
	facebookEventUrl: string | null;
	instagramPostUrl: string | null;
	externalUrl: string | null;
	venue: VenueEvento | null;
	generi: GenereEvento[];
	generePrimario: GenereEvento | null;
	lineup: VoceLineup[];
	links: LinkEvento[];
	/** Solo per la propria organizzazione. Altrove è sempre `null`. */
	internalNotes: string | null;
	/** Idem: la data di annuncio prevista non esce mai dall'organizzazione. */
	announceAt: Date | null;
	conflictRadiusKm: number | null;
};

export type EventoSerializzato = EventoRidotto | EventoCompleto;

/* ------------------------------------------------------------------ *
 * La funzione
 * ------------------------------------------------------------------ */

function generePrimarioDi(generi: GenereEvento[]): GenereEvento | null {
	return generi.find((g) => g.isPrimary) ?? null;
}

/**
 * Serializza un evento per un viewer, applicando la matrice di §5.
 *
 * Restituisce `null` quando l'evento non deve nemmeno risultare esistente:
 * oggi è il solo caso della bozza altrui. Chi chiama deve trattare il `null`
 * come "non esiste", non come "errore".
 *
 * Il ruolo non conta e `isPlatformAdmin` nemmeno: la visibilità dipende solo
 * dall'appartenenza all'organizzazione proprietaria. Un platform admin
 * amministra inviti e tassonomie, non è un lettore privilegiato delle date
 * altrui — sarebbe esattamente il potere che ADR-0005 nega ai concorrenti.
 */
export function serializeEvent(
	event: EventWithRelations,
	viewer: ViewerContext
): EventoSerializzato | null {
	const proprio = ownsOrganization(viewer, event.organizationId);

	const base: Base = {
		id: event.id,
		status: event.status,
		proprio,
		giorno: giornoCivile(event.startsAt),
		city: event.city,
		province: event.province,
		organizzazione: event.organization
	};

	// Bozza altrui: non esiste. Nemmeno come riga vuota nel calendario.
	if (!proprio && event.status === 'draft') return null;

	if (!proprio && event.status === 'hold') {
		return {
			...base,
			visibilita: 'ridotta',
			generePrimario: generePrimarioDi(event.genres)
		};
	}

	// Da qui in poi: o è nostro (qualunque stato), o è `confirmed`/`cancelled`
	// di un altro. Cambia solo ciò che resta dentro l'organizzazione.
	return {
		...base,
		visibilita: 'completa',
		title: event.title,
		subtitle: event.subtitle,
		description: event.description,
		startsAt: event.startsAt,
		endsAt: event.endsAt,
		doorsAt: event.doorsAt,
		isMultiDay: event.isMultiDay,
		region: event.region,
		country: event.country,
		lat: event.lat,
		lon: event.lon,
		isFree: event.isFree,
		isMembersOnly: event.isMembersOnly,
		pricePresale: event.pricePresale,
		priceDoor: event.priceDoor,
		currency: event.currency,
		ticketUrl: event.ticketUrl,
		ageRestriction: event.ageRestriction,
		capacityExpected: event.capacityExpected,
		posterUrl: event.posterUrl,
		facebookEventUrl: event.facebookEventUrl,
		instagramPostUrl: event.instagramPostUrl,
		externalUrl: event.externalUrl,
		venue: event.venue,
		generi: event.genres,
		generePrimario: generePrimarioDi(event.genres),
		// La rivelazione progressiva della lineup vale anche a evento
		// annullato. La matrice di §5 segna quella cella come visibile, ma un
		// `hold` annullato esporrebbe di colpo una lineup mai annunciata:
		// sarebbe il contrario di ciò per cui `hold` esiste. Fuori
		// dall'organizzazione si vede solo ciò che è stato annunciato.
		lineup: proprio ? event.lineup : event.lineup.filter((v) => v.isAnnounced),
		links: event.links,
		internalNotes: proprio ? event.internalNotes : null,
		announceAt: proprio ? event.announceAt : null,
		conflictRadiusKm: proprio ? event.conflictRadiusKm : null
	};
}

/** Serializza una lista, scartando ciò che il viewer non deve vedere. */
export function serializeEvents(
	events: EventWithRelations[],
	viewer: ViewerContext
): EventoSerializzato[] {
	return events
		.map((e) => serializeEvent(e, viewer))
		.filter((e): e is EventoSerializzato => e !== null);
}

/**
 * Etichetta con cui un evento si presenta in calendario.
 *
 * Sta qui e non in un componente di proposito: il titolo di un `hold` altrui è
 * un dato ridotto, e decidere cosa scriverci è materia di visibilità. Lo
 * stesso testo servirà al feed ICS in Fase 4 e alle email in Fase 6.
 */
export function titoloVisibile(evento: EventoSerializzato): string {
	if (evento.visibilita === 'completa') return evento.title;
	const genere = evento.generePrimario?.name;
	return genere ? `${genere} · ${evento.organizzazione.name}` : evento.organizzazione.name;
}
