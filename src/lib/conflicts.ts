/**
 * Testi dei conflitti, condivisi fra server e browser.
 *
 * Sta fuori da `$lib/server` per lo stesso motivo di `$lib/events.ts`: la
 * dashboard e l'anteprima nel form li mostrano nel bundle del client. Vale la
 * stessa regola pratica — qui ci vanno solo nomi da mostrare, mai decisioni.
 * Chi vede un conflitto e cosa gliene si racconta lo decide `redigiConflitto`
 * sul server (ADR-0024).
 *
 * I testi sono la parte del motore che l'utente incontra davvero. Se un
 * avviso non si capisce, la telefonata non parte e le regole potevano anche
 * non esserci.
 */
import type { ConflictKind, ConflictSeverity, ConflictStatus } from '$lib/server/db/schema';

export const ETICHETTE_CONFLITTO: Record<ConflictKind, string> = {
	venue_clash: 'Stesso locale',
	artist_overlap: 'Stessa band',
	geo_genre_overlap: 'Stesso pubblico',
	same_day_proximity: 'Stessa sera in zona'
};

export const ETICHETTE_SEVERITA: Record<ConflictSeverity, string> = {
	high: 'Grave',
	medium: 'Da guardare',
	low: 'Informativo'
};

export const ETICHETTE_STATO_CONFLITTO: Record<ConflictStatus, string> = {
	open: 'Aperto',
	acknowledged: 'Preso atto',
	resolved: 'Risolto',
	dismissed: 'Archiviato'
};

/** Ordine di lettura: prima ciò che è più probabile sia un problema vero. */
export const ORDINE_SEVERITA: Record<ConflictSeverity, number> = { high: 0, medium: 1, low: 2 };

/**
 * Il minimo che serve per scrivere l'avviso.
 *
 * È un tipo strutturale di proposito: lo soddisfano sia i conflitti
 * persistiti che escono da `serializeConflict`, sia quelli calcolati al volo
 * dall'anteprima nel form, che non hanno un `id` né uno stato. Un solo
 * insieme di testi per le due strade — se divergessero, l'avviso mostrato
 * mentre si compila non sarebbe quello che poi arriva in dashboard.
 */
export type ConflittoLeggibile = {
	kind: ConflictKind;
	severity: ConflictSeverity;
	distanzaKm: number | null;
	giorniDiDistanza: number | null;
	controparte: {
		giorno: string;
		city: string;
		organizzazione: { name: string; emailContact: string | null };
	};
	/** Le band che *questo* lettore può sentire nominare. Mai le altre. */
	artisti: { id: string; nome: string }[];
	venue: { name: string } | null;
};

const elenco = (nomi: string[]): string =>
	nomi.length <= 1 ? (nomi[0] ?? '') : `${nomi.slice(0, -1).join(', ')} e ${nomi[nomi.length - 1]}`;

const distanza = (km: number | null): string =>
	km === null ? 'a distanza sconosciuta' : km < 1 ? 'nello stesso posto' : `a ${Math.round(km)} km`;

/**
 * Il titolo dell'avviso: una riga, letta di sfuggita, deve bastare a capire
 * se vale la pena aprire.
 */
export function titoloConflitto(c: ConflittoLeggibile): string {
	if (c.kind === 'artist_overlap' && c.giorniDiDistanza === 0) {
		// ADR-0021: lo stesso giorno non è concorrenza, è un doppio ingaggio.
		// Il messaggio deve dirlo con parole diverse dagli altri casi.
		return 'Una band della tua lineup risulta impegnata altrove quella sera';
	}
	if (c.kind === 'artist_overlap') return 'Una band della tua lineup suona qui vicino';
	if (c.kind === 'venue_clash') return 'Due date nello stesso locale, in sovrapposizione';
	if (c.kind === 'geo_genre_overlap') return 'Stessa sera, stessa zona, pubblico simile';
	return 'Un’altra serata in zona la stessa sera';
}

/**
 * La spiegazione: perché è arrivato quest'avviso, in una frase.
 *
 * Non contiene mai un giudizio su chi ha ragione. Il calendario mette in
 * contatto due pari e non ha titolo per decidere quale delle due serate abbia
 * diritto a quella data (ADR-0022): il verbo giusto è sempre "risulta", mai
 * "devi".
 */
export function spiegazioneConflitto(c: ConflittoLeggibile): string {
	const chi = c.controparte.organizzazione.name;
	const dove = c.controparte.city;

	switch (c.kind) {
		case 'venue_clash': {
			const locale = c.venue?.name ?? 'lo stesso locale';
			return `${locale} risulta occupato da ${chi} in orari che si accavallano con i tuoi. Non è una questione di pubblico: una delle due date ha un problema materiale.`;
		}
		case 'artist_overlap': {
			const nomi = elenco(c.artisti.map((a) => a.nome));
			if (c.giorniDiDistanza === 0) {
				return `${nomi} risulta in cartellone anche da ${chi}, a ${dove}, la tua stessa sera. O c’è un doppio ingaggio, o una delle due date è stata inserita sbagliata.`;
			}
			const giorni = c.giorniDiDistanza ?? 0;
			const quando = giorni === 1 ? 'il giorno prima o dopo' : `a ${giorni} giorni di distanza`;
			return `${nomi} suona anche da ${chi}, a ${dove}, ${quando} e ${distanza(c.distanzaKm)}. Buona parte del pubblico è lo stesso.`;
		}
		case 'geo_genre_overlap':
			return `${chi} ha una data la tua stessa sera a ${dove}, ${distanza(c.distanzaKm)}, su generi vicini ai tuoi. Chi verrebbe da te potrebbe dover scegliere.`;
		default:
			return `${chi} ha una data la tua stessa sera a ${dove}, ${distanza(c.distanzaKm)}, su generi diversi dai tuoi. È solo per saperlo: quella sera la zona è viva.`;
	}
}

/**
 * Che cosa conviene fare. Sempre la stessa cosa, in fondo: parlarsi.
 *
 * Il prodotto non blocca né arbitra (ADR-0009, ADR-0022): l'obiettivo di ogni
 * avviso è una telefonata fra due organizzatori, non un divieto.
 */
export const INVITO_AL_CONTATTO =
	'Il calendario non decide niente al posto vostro: se la cosa vi riguarda davvero, sentitevi.';

/** Indirizzo `mailto:` già intestato, quando la controparte ne ha uno. */
export function mailtoControparte(c: ConflittoLeggibile): string | null {
	const email = c.controparte.organizzazione.emailContact;
	if (!email) return null;
	const oggetto = `Data del ${c.controparte.giorno} a ${c.controparte.city}`;
	return `mailto:${email}?subject=${encodeURIComponent(oggetto)}`;
}

/**
 * La forma in cui l'anteprima del form manda i conflitti al browser.
 *
 * Non ha `id` né stato perché il conflitto non è ancora stato persistito:
 * esisterà quando la data verrà salvata. Ha però tutto ciò che serve ai testi
 * e al pulsante di contatto, che è ciò che conta mentre si compila.
 */
export type AnteprimaConflitto = ConflittoLeggibile & {
	/** Identificativo stabile della coppia, per la `key` del `#each`. */
	chiave: string;
	statoControparte: string;
};

export type EsitoAnteprima = {
	conflitti: AnteprimaConflitto[];
	/**
	 * Perché l'anteprima non ha potuto dire niente: manca la data, manca il
	 * luogo. È un'informazione utile — "nessun conflitto" e "non ho potuto
	 * controllare" sono due cose molto diverse da leggere sotto un form.
	 */
	incompleto: string | null;
};
