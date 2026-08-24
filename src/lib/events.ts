/**
 * Etichette e forme condivise fra server e browser.
 *
 * Sta fuori da `$lib/server` perché il calendario e i form ne hanno bisogno
 * nel bundle del client, e SvelteKit — giustamente — rifiuta di importare
 * `$lib/server` da lì. La regola pratica: qui ci va ciò che è solo un nome da
 * mostrare, mai una decisione. Le decisioni (chi vede cosa, quali transizioni
 * sono ammesse) restano sul server.
 *
 * Tutti i testi visibili stanno in questo modulo o accanto al componente che
 * li usa: se un giorno servirà l'italiano più un'altra lingua, il lavoro sarà
 * lungo ma non archeologico (ARCHITECTURE.md §11).
 */
import type { EventStatus } from '$lib/server/db/schema';

export const ETICHETTE_STATO: Record<EventStatus, string> = {
	draft: 'Bozza',
	hold: 'Opzionata',
	confirmed: 'Confermata',
	cancelled: 'Annullata'
};

export const DESCRIZIONI_STATO: Record<EventStatus, string> = {
	draft: 'Visibile solo alla tua organizzazione. Nessun altro sa che esiste.',
	hold:
		'Gli altri organizzatori vedono giorno, città, genere principale e come contattarti. ' +
		'Non vedono orario, locale, titolo né lineup.',
	confirmed: 'Visibile a tutti in ogni dettaglio annunciato.',
	cancelled:
		'Resta visibile con il badge di annullata: agli altri serve sapere che lo slot è libero.'
};

export const ETICHETTE_LOCANDINA = {
	headliner: 'Headliner',
	co_headliner: 'Co-headliner',
	special_guest: 'Special guest',
	support: 'Support',
	opener: 'Apertura',
	dj: 'DJ set',
	tba: 'Da annunciare'
} as const;

/** La forma che il calendario riceve da `/api/events`. */
export type EventoCalendario = {
	id: string;
	title: string;
	start: string;
	end?: string;
	allDay: boolean;
	/**
	 * Il link alla pagina della data.
	 *
	 * Non serve alla navigazione — quella la fa `eventClick` con `goto`, per
	 * non ricaricare la pagina — ma a **esistere come link**: senza `href`
	 * FullCalendar rende un'ancora che la tastiera non può raggiungere, e il
	 * calendario diventa un oggetto da usare solo col mouse.
	 */
	url: string;
	classNames: string[];
	extendedProps: {
		status: EventStatus;
		statusEtichetta: string;
		proprio: boolean;
		ridotto: boolean;
		citta: string;
		provincia: string | null;
		organizzazione: string;
		organizzazioneEmail: string | null;
		genere: string | null;
		locale: string | null;
		ora: string | null;
	};
};

/** Una riga di lineup come la maneggia il form. */
export type VoceLineupForm = {
	id: string | null;
	artistId: string | null;
	artistName: string;
	billing: keyof typeof ETICHETTE_LOCANDINA;
	stage: string;
	setStartsAtLocal: string;
	isAnnounced: boolean;
};

/**
 * I valori del form evento, tutti come stringhe.
 *
 * Restano stringhe fino alla validazione Zod: è la forma in cui arrivano dal
 * browser e in cui vanno rimandati indietro quando il salvataggio fallisce,
 * così l'utente non perde ciò che aveva scritto.
 */
export type ValoriEvento = {
	organizationId: string;
	status: EventStatus;
	title: string;
	subtitle: string;
	description: string;
	venueId: string;
	city: string;
	province: string;
	region: string;
	startsAtLocal: string;
	endsAtLocal: string;
	doorsAtLocal: string;
	announceAtLocal: string;
	isMultiDay: boolean;
	conflictRadiusKm: string;
	isFree: boolean;
	isMembersOnly: boolean;
	pricePresale: string;
	priceDoor: string;
	ticketUrl: string;
	ageRestriction: string;
	capacityExpected: string;
	posterUrl: string;
	facebookEventUrl: string;
	instagramPostUrl: string;
	externalUrl: string;
	primaryGenreSlug: string;
	secondaryGenreSlugs: string[];
	internalNotes: string;
	lineup: VoceLineupForm[];
	links: { label: string; url: string }[];
};
