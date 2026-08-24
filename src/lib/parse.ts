/**
 * Forme e testi dell'import assistito, condivisi fra server e browser.
 *
 * Sta fuori da `$lib/server` per la stessa ragione di `$lib/events.ts` e
 * `$lib/conflicts.ts`: il pannello dell'incolla vive nel bundle del client, e
 * SvelteKit — giustamente — rifiuta di importare `$lib/server` da lì. Vale la
 * stessa regola pratica: qui ci va ciò che è solo un nome da mostrare, mai una
 * decisione. Che cosa si estrae, che cosa si collega e che cosa resta di una
 * persona lo decide il server (ADR-0031).
 */
import type { ValoriEvento } from '$lib/events';

export type Sorgente = 'ics' | 'csv' | 'testo';

/** Perché una scheda dell'anagrafica è stata proposta per quella band. */
export type MotivoCandidato = 'mbid' | 'nome-identico' | 'nome-simile';

export type CandidatoArtista = {
	id: string;
	name: string;
	motivo: MotivoCandidato;
};

export type PropostaArtista = {
	/** L'indice della riga di lineup, per legare la proposta al campo giusto. */
	indice: number;
	nome: string;
	candidati: CandidatoArtista[];
};

/** La risposta di `POST /api/parse`. */
export type EsitoImport = {
	sorgente: Sorgente;
	valori: ValoriEvento;
	/** I `name` degli input riempiti dal parser. */
	compilati: string[];
	avvisi: string[];
	proposte: PropostaArtista[];
	/** Valorizzato quando non si è letto niente: il form resta com'era. */
	errore: string | null;
};

export const ETICHETTE_SORGENTE: Record<Sorgente, string> = {
	ics: 'file di calendario',
	csv: 'tabella',
	testo: 'testo libero'
};

/**
 * Come si è arrivati al risultato, in una riga.
 *
 * Vale la pena dirlo: le due strade deterministiche non passano da nessun
 * modello, e sapere quale delle due ha letto il file è la prima cosa che
 * serve quando qualcosa è finito nel campo sbagliato.
 */
export function comeLetto(sorgente: Sorgente): string {
	return sorgente === 'testo'
		? 'Letto da un modello linguistico: ricontrolla i campi prima di salvare.'
		: `Letto come ${ETICHETTE_SORGENTE[sorgente]}, senza passare da nessun modello.`;
}

export const ETICHETTE_MOTIVO: Record<MotivoCandidato, string> = {
	mbid: 'stesso identificativo MusicBrainz',
	'nome-identico': 'stesso nome',
	'nome-simile': 'nome simile'
};

/**
 * Etichette dei campi del form, per dire che cosa è stato riempito.
 *
 * Un elenco di `name` di input — `startsAtLocal`, `primaryGenreSlug` — non è
 * qualcosa che si mette davanti a un organizzatore.
 */
export const ETICHETTE_CAMPO: Partial<Record<keyof ValoriEvento, string>> = {
	title: 'titolo',
	subtitle: 'sottotitolo',
	description: 'descrizione',
	venueId: 'locale',
	city: 'città',
	province: 'provincia',
	startsAtLocal: 'inizio',
	endsAtLocal: 'fine',
	doorsAtLocal: 'apertura porte',
	isFree: 'ingresso libero',
	pricePresale: 'prezzo in prevendita',
	priceDoor: 'prezzo alla porta',
	ticketUrl: 'link prevendita',
	ageRestriction: 'età',
	externalUrl: 'link',
	facebookEventUrl: 'evento Facebook',
	instagramPostUrl: 'post Instagram',
	primaryGenreSlug: 'genere principale',
	secondaryGenreSlugs: 'generi secondari',
	lineup: 'lineup'
};

export function etichettaCampo(nome: string): string {
	return ETICHETTE_CAMPO[nome as keyof ValoriEvento] ?? nome;
}
