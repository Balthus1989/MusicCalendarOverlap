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
import type {
	BillingRole,
	ConflictKind,
	ConflictSeverity,
	ConflictStatus,
	EventStatus,
	MemberRole
} from '$lib/server/db/schema';
import type { DettagliConflitto } from '$lib/server/conflicts/rules';

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

/* ------------------------------------------------------------------ *
 * Conflitti (ADR-0024)
 * ------------------------------------------------------------------ */

/**
 * La riga `conflicts` come esce dal database, con i dettagli tipizzati.
 *
 * `details` è `jsonb` e Drizzle lo restituisce come `unknown`: la forma vera
 * la conosce `conflicts/rules.ts`, che l'ha scritta.
 */
export type ConflittoGrezzo = {
	id: string;
	eventAId: string;
	eventBId: string;
	kind: ConflictKind;
	severity: ConflictSeverity;
	status: ConflictStatus;
	distanceKm: string | null;
	genreAffinity: string | null;
	daysApart: number | null;
	details: DettagliConflitto | null;
	acknowledgedByA: boolean;
	acknowledgedByB: boolean;
	resolutionNote: string | null;
	computedAt: Date;
	updatedAt: Date;
};

export type ArtistaNominabile = { id: string; nome: string };

export type ConflittoSerializzato = {
	id: string;
	kind: ConflictKind;
	severity: ConflictSeverity;
	status: ConflictStatus;
	distanzaKm: number | null;
	affinita: number | null;
	giorniDiDistanza: number | null;
	/** La data del viewer. Sempre in visibilità completa: è sua. */
	mia: EventoCompleto;
	/** La controparte, redatta secondo la matrice di §5. */
	controparte: EventoSerializzato;
	/** Vero se il *proprio* lato ha già preso atto del conflitto. */
	presoAtto: boolean;
	/** Vero se ne ha preso atto la controparte: dice se la telefonata è partita. */
	presoAttoDallAltro: boolean;
	/**
	 * Le band condivise di cui questo viewer può sentire il nome. Mai le
	 * altre, e mai quante sono: il numero di band segrete della controparte è
	 * esso stesso un'informazione riservata.
	 */
	artisti: ArtistaNominabile[];
	/** Il locale in comune, quando la regola è R1 e il viewer può vederlo. */
	venue: VenueEvento | null;
	resolutionNote: string | null;
};

const numero = (v: string | null): number | null => (v === null ? null : Number(v));

/** Ciò che di un conflitto un dato viewer può effettivamente sapere. */
export type RedazioneConflitto = {
	artisti: ArtistaNominabile[];
	venue: VenueEvento | null;
	affinita: number | null;
};

/**
 * Il nucleo della redazione, condiviso da `serializeConflict` e
 * dall'anteprima nel form.
 *
 * Il principio, uno solo per tutte e quattro le regole: **un conflitto si
 * racconta a un organizzatore solo nella misura in cui il dato che lo produce
 * gli è già visibile** (ADR-0024). Restituisce `null` quando non gli si può
 * raccontare niente, e allora il conflitto per lui non esiste affatto.
 *
 * `sonoLatoA` dice da che parte della coppia ordinata sta chi guarda: serve a
 * leggere i flag di annuncio dal lato giusto.
 */
export function redigiConflitto(
	kind: ConflictKind,
	dettagli: DettagliConflitto | null,
	affinitaGrezza: number | null,
	controparte: EventoSerializzato,
	sonoLatoA: boolean,
	nomiArtisti: Record<string, string> = {}
): RedazioneConflitto | null {
	const completa = controparte.visibilita === 'completa' ? controparte : null;

	// Un conflitto di locale *è* il locale, e in `hold` il locale è
	// riservato. Chi lo riceve conosce il proprio, quindi dedurrebbe l'altro:
	// non c'è modo di raccontarglielo a metà. Se ne accorge comunque chi ha
	// tenuto il locale riservato, che è anche l'unico dei due a poterlo
	// cambiare senza rimangiarsi un annuncio.
	if (kind === 'venue_clash' && !completa) return null;

	let artisti: ArtistaNominabile[] = [];
	if (kind === 'artist_overlap') {
		// "Annunciata dalla controparte": se chi guarda sta dal lato A conta
		// `annunciatoB`, e viceversa. Una band che *lui* ha annunciato ma la
		// controparte no resta muta, perché nominarla direbbe che la
		// controparte l'ha ingaggiata — cioè esattamente il segreto di `hold`.
		artisti = (dettagli?.artisti ?? [])
			.filter((x) => (sonoLatoA ? x.annunciatoB : x.annunciatoA))
			.map((x) => ({ id: x.artistId, nome: nomiArtisti[x.artistId] ?? 'Band non in anagrafica' }));

		// Nemmeno il *numero* di band condivise può uscire: chi guarda conosce
		// la propria lineup, e sapere che tre sue band sono in cartellone da
		// un'altra parte gli direbbe quali. Se non se ne può nominare
		// nessuna, il conflitto non gli si mostra.
		if (!artisti.length) return null;
	}

	return {
		artisti,
		venue: kind === 'venue_clash' ? (completa?.venue ?? null) : null,
		// L'affinità è calcolata anche sui generi secondari, che in `hold`
		// restano riservati: esce solo quando la controparte è tutta visibile.
		affinita: completa ? affinitaGrezza : null
	};
}

/**
 * Serializza un conflitto per un viewer.
 *
 * Il motore rileva su dati completi, perché una rilevazione filtrata non
 * sarebbe simmetrica: i conflitti comparirebbero e sparirebbero a seconda di
 * quale delle due date viene salvata per ultima. La redazione avviene qui, in
 * uscita, come per gli eventi — la fa `redigiConflitto` (ADR-0024).
 *
 * Restituisce `null` quando il conflitto, per questo viewer, non deve
 * risultare esistente: non è membro di nessuna delle due organizzazioni, la
 * controparte è una bozza (non capita, ma la garanzia non costa nulla), o
 * `redigiConflitto` non gli lascia niente da raccontare.
 */
export function serializeConflict(
	conflitto: ConflittoGrezzo,
	eventi: { a: EventWithRelations; b: EventWithRelations },
	viewer: ViewerContext,
	nomiArtisti: Record<string, string> = {}
): ConflittoSerializzato | null {
	const sonoA = ownsOrganization(viewer, eventi.a.organizationId);
	const sonoB = ownsOrganization(viewer, eventi.b.organizationId);
	// Un estraneo alle due organizzazioni non ha titolo per sapere che due
	// date si danno fastidio: non è un'informazione del calendario, è una
	// conversazione fra due persone.
	if (!sonoA && !sonoB) return null;

	// Se per qualche motivo appartenesse a entrambe, il lato A fa da "suo":
	// vedrebbe comunque tutto di tutte e due.
	const mioGrezzo = sonoA ? eventi.a : eventi.b;
	const altroGrezzo = sonoA ? eventi.b : eventi.a;

	const mia = serializeEvent(mioGrezzo, viewer);
	const controparte = serializeEvent(altroGrezzo, viewer);
	if (!mia || !controparte || mia.visibilita !== 'completa') return null;

	const redazione = redigiConflitto(
		conflitto.kind,
		conflitto.details,
		numero(conflitto.genreAffinity),
		controparte,
		sonoA,
		nomiArtisti
	);
	if (!redazione) return null;

	return {
		id: conflitto.id,
		kind: conflitto.kind,
		severity: conflitto.severity,
		status: conflitto.status,
		distanzaKm: numero(conflitto.distanceKm),
		affinita: redazione.affinita,
		giorniDiDistanza: conflitto.daysApart,
		mia,
		controparte,
		presoAtto: sonoA ? conflitto.acknowledgedByA : conflitto.acknowledgedByB,
		presoAttoDallAltro: sonoA ? conflitto.acknowledgedByB : conflitto.acknowledgedByA,
		artisti: redazione.artisti,
		venue: redazione.venue,
		resolutionNote: conflitto.resolutionNote
	};
}

/** Serializza una lista, scartando ciò che il viewer non deve vedere. */
export function serializeConflicts(
	righe: {
		conflitto: ConflittoGrezzo;
		a: EventWithRelations;
		b: EventWithRelations;
	}[],
	viewer: ViewerContext,
	nomiArtisti: Record<string, string> = {}
): ConflittoSerializzato[] {
	return righe
		.map((r) => serializeConflict(r.conflitto, { a: r.a, b: r.b }, viewer, nomiArtisti))
		.filter((c): c is ConflittoSerializzato => c !== null);
}
