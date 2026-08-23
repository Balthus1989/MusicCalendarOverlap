/**
 * Generatore di copy per i social (ARCHITECTURE.md §8, ADR-0012).
 *
 * **Non pubblica niente, e non è un ripiego provvisorio.** La creazione
 * programmatica di eventi su Meta non è disponibile: questa è la sostituzione
 * onesta di una funzione che non può esistere. Elimina il vero costo, che è
 * riscrivere a mano gli stessi dati per la terza volta, senza promettere
 * un'automazione impossibile.
 *
 * Codice puro su `EventoSerializzato`: il testo si genera da ciò che chi lo
 * chiede può già vedere. Una band non annunciata non arriva nemmeno qui, e non
 * finisce per sbaglio in un post scritto la settimana prima dell'annuncio.
 */
import { ETICHETTE_LOCANDINA } from '$lib/events';
import { oraCivile } from '$lib/time';
import { slugify } from '$lib/server/text';
import type { EventoCompleto, EventoSerializzato } from '$lib/server/visibility';

export const PIATTAFORME = ['instagram', 'facebook', 'telegram'] as const;
export type Piattaforma = (typeof PIATTAFORME)[number];

export function isPiattaforma(v: string): v is Piattaforma {
	return (PIATTAFORME as readonly string[]).includes(v);
}

const formatoGiorno = new Intl.DateTimeFormat('it-IT', {
	weekday: 'long',
	day: 'numeric',
	month: 'long',
	timeZone: 'Europe/Rome'
});

/** "sabato 12 ottobre", con l'iniziale maiuscola. */
function giornoEsteso(giorno: string): string {
	const testo = formatoGiorno.format(new Date(`${giorno}T12:00:00Z`));
	return testo.charAt(0).toUpperCase() + testo.slice(1);
}

function prezzo(v: string | null): string | null {
	return v === null ? null : `${Number(v).toFixed(2).replace('.', ',')} €`;
}

function ingresso(e: EventoCompleto): string | null {
	if (e.isFree)
		return e.isMembersOnly ? 'Ingresso libero, riservato ai tesserati' : 'Ingresso libero';
	const parti = [
		prezzo(e.pricePresale) && `${prezzo(e.pricePresale)} in prevendita`,
		prezzo(e.priceDoor) && `${prezzo(e.priceDoor)} alla porta`
	].filter(Boolean);
	if (!parti.length) return e.isMembersOnly ? 'Riservato ai tesserati' : null;
	const testo = parti.join(' · ');
	return e.isMembersOnly ? `${testo} · riservato ai tesserati` : testo;
}

function luogo(e: EventoCompleto): string {
	const citta = e.province ? `${e.city} (${e.province})` : e.city;
	return e.venue ? `${e.venue.name}, ${citta}` : citta;
}

/**
 * Hashtag dai generi della serata.
 *
 * Dai generi e non dalle band: i nomi delle band cambiano da un post
 * all'altro, i generi no, ed è sui generi che un pubblico cerca. Restano
 * comunque da rileggere prima di pubblicare — è testo da copiare, non da fidarsi.
 */
export function hashtag(e: EventoCompleto): string[] {
	const dai = (nome: string) => `#${slugify(nome).replace(/-/g, '')}`;
	const generi = e.generi.map((g) => dai(g.name));
	const luoghi = [dai(e.city), '#liveMusic'];
	// `Set` e non `filter`: due generi possono normalizzare sullo stesso tag.
	return [...new Set([...generi, ...luoghi])].filter((t) => t.length > 1);
}

function lineup(e: EventoCompleto, conRuoli: boolean): string[] {
	return e.lineup.map((v) =>
		conRuoli && v.billing !== 'tba' ? `${v.nome} (${ETICHETTE_LOCANDINA[v.billing]})` : v.nome
	);
}

/**
 * L'esito: il testo, più ciò che serve a mostrarlo bene.
 *
 * `avvisi` non è decorazione. Un post preparato per una data ancora opzionata
 * è la cosa più facile da pubblicare per sbaglio, ed è esattamente ciò che
 * ADR-0005 esiste per evitare: chi genera il testo deve leggerselo scritto.
 */
export type CopySociale = {
	piattaforma: Piattaforma;
	testo: string;
	caratteri: number;
	avvisi: string[];
};

function avvisiPer(e: EventoCompleto): string[] {
	const avvisi: string[] = [];
	if (e.status === 'draft' || e.status === 'hold') {
		avvisi.push(
			'Questa data non è ancora confermata: pubblicare il testo equivale ad annunciarla.'
		);
	}
	if (e.status === 'cancelled') {
		avvisi.push('Questa data è annullata: il testo descrive una serata che non si farà.');
	}
	if (!e.lineup.length) {
		avvisi.push('Nessuna band annunciata: nel testo non compare nessun nome.');
	} else if (!e.proprio) {
		avvisi.push('La lineup contiene solo le band già annunciate da chi organizza.');
	}
	if (!e.venue) avvisi.push('Manca il locale: nel testo c’è solo la città.');
	return avvisi;
}

/* ------------------------------------------------------------------ *
 * Le tre voci
 * ------------------------------------------------------------------ */

/**
 * Instagram non rende cliccabile nessun link nella didascalia. Metterceli
 * comunque produce quel testo con l'URL nudo che nessuno può usare: meglio
 * dire dov'è il link e mettere gli hashtag in fondo, dove si aspettano.
 */
function perInstagram(e: EventoCompleto, baseUrl: string): string {
	const righe = [
		e.title.toUpperCase(),
		e.subtitle ?? null,
		'',
		`${giornoEsteso(e.giorno)} · ore ${oraCivile(e.startsAt)}`,
		luogo(e),
		''
	];

	const band = lineup(e, false);
	if (band.length) righe.push(band.join('\n'), '');

	const costo = ingresso(e);
	if (costo) righe.push(costo);
	if (e.ticketUrl) righe.push('Prevendita: link in bio');
	righe.push('', hashtag(e).join(' '));

	return componi(righe, baseUrl, e, false);
}

/** Su Facebook i link funzionano, e il testo lungo si legge. */
function perFacebook(e: EventoCompleto, baseUrl: string): string {
	const righe = [
		e.title,
		e.subtitle ?? null,
		'',
		`📅 ${giornoEsteso(e.giorno)}, ore ${oraCivile(e.startsAt)}${
			e.doorsAt ? ` (porte ${oraCivile(e.doorsAt)})` : ''
		}`,
		`📍 ${luogo(e)}`
	];

	const band = lineup(e, true);
	if (band.length) righe.push('', 'In concerto:', ...band.map((b) => `· ${b}`));

	const costo = ingresso(e);
	if (costo) righe.push('', `🎟️ ${costo}`);
	if (e.ticketUrl) righe.push(`Prevendita: ${e.ticketUrl}`);
	if (e.description) righe.push('', e.description);

	return componi(righe, baseUrl, e, true);
}

/** Telegram: compatto, link inline, nessun hashtag — in un canale sono rumore. */
function perTelegram(e: EventoCompleto, baseUrl: string): string {
	const band = lineup(e, false);
	const costo = ingresso(e);

	const righe = [
		`${e.title} — ${giornoEsteso(e.giorno)}, ore ${oraCivile(e.startsAt)}`,
		luogo(e),
		band.length ? `Con ${band.join(', ')}.` : null,
		costo
	];

	if (e.ticketUrl) righe.push(`Biglietti: ${e.ticketUrl}`);

	return componi(righe, baseUrl, e, true);
}

/**
 * Chiude il testo con l'organizzazione e il link alla pagina, e compatta le
 * righe vuote: costruendo il testo a pezzi condizionali se ne accumulano due o
 * tre di fila senza accorgersene.
 */
function componi(
	righe: (string | null)[],
	baseUrl: string,
	e: EventoCompleto,
	conLink: boolean
): string {
	const coda = conLink
		? ['', `Organizza ${e.organizzazione.name}`, `${baseUrl}/events/${e.id}`]
		: ['', `Organizza ${e.organizzazione.name}`];

	return [...righe, ...coda]
		.filter((r): r is string => r !== null)
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/**
 * Il testo pronto da copiare, oppure `null` se di questa data non c'è ancora
 * niente da annunciare — il caso di un `hold` altrui, che di suo non ha
 * nemmeno un titolo.
 */
export function generaCopy(
	evento: EventoSerializzato,
	piattaforma: Piattaforma,
	baseUrl: string
): CopySociale | null {
	if (evento.visibilita !== 'completa') return null;

	const testo =
		piattaforma === 'instagram'
			? perInstagram(evento, baseUrl)
			: piattaforma === 'facebook'
				? perFacebook(evento, baseUrl)
				: perTelegram(evento, baseUrl);

	return {
		piattaforma,
		testo,
		caratteri: [...testo].length,
		avvisi: avvisiPer(evento)
	};
}
