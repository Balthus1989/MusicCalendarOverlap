/**
 * I testi delle notifiche (ARCHITECTURE.md §10).
 *
 * Codice puro, come i testi dei conflitti: entra ciò che il destinatario può
 * già vedere — un `ConflittoSerializzato`, un `EventoCompleto` che è suo — ed
 * esce un `Avviso` con dentro il testo definitivo. Nessuna query, nessun
 * `fetch`, nessuna decisione su chi vede cosa: quella è già stata presa a
 * monte da `serializeConflict` (ADR-0024, ADR-0035).
 *
 * La conseguenza pratica è che questo file si testa riga per riga senza
 * database, ed è dove si controlla la cosa che conta davvero: che il nome di
 * una band non annunciata non compaia in nessun avviso che esce di qui.
 *
 * I testi riusano quelli della dashboard invece di riscriverli. Se un avviso
 * consegnato fuori dicesse le cose in modo diverso da come le dice la
 * pagina, chi apre il link dopo averlo letto penserebbe di essere finito
 * altrove.
 */
import {
	INVITO_AL_CONTATTO,
	spiegazioneConflitto,
	titoloConflitto,
	type ConflittoLeggibile
} from '$lib/conflicts';
import { ETICHETTE_STATO } from '$lib/events';
import { giornoCivile } from '$lib/time';
import type { ConflittoSerializzato, EventoCompleto } from '$lib/server/visibility';
import type { Avviso, Destinatario } from './types';

const formatoGiorno = new Intl.DateTimeFormat('it-IT', {
	weekday: 'long',
	day: 'numeric',
	month: 'long',
	timeZone: 'Europe/Rome'
});

/** "Sabato 12 ottobre", con l'iniziale maiuscola. */
export function giornoEsteso(giorno: string): string {
	const testo = formatoGiorno.format(new Date(`${giorno}T12:00:00Z`));
	return testo.charAt(0).toUpperCase() + testo.slice(1);
}

const citta = (e: { city: string; province: string | null }): string =>
	e.province ? `${e.city} (${e.province})` : e.city;

/**
 * Da un conflitto serializzato alla forma che i testi si aspettano.
 *
 * `ConflittoSerializzato` ha già tutto, ma annidato: i testi di
 * `$lib/conflicts.ts` sono strutturali apposta per essere condivisi fra la
 * dashboard, l'anteprima nel form e — da qui — le notifiche.
 */
function leggibile(c: ConflittoSerializzato): ConflittoLeggibile {
	return {
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
	};
}

/* ------------------------------------------------------------------ *
 * Conflitti
 * ------------------------------------------------------------------ */

/**
 * Un conflitto nuovo di severity `medium` o `high` (§10, riga 1).
 *
 * Il conflitto arriva **già redatto**: se a questo destinatario non se ne
 * poteva raccontare niente, `serializeConflict` ha restituito `null` e questa
 * funzione non viene mai chiamata. È lo stesso muro di ADR-0024, e vale la
 * pena ripeterlo qui perché un messaggio già consegnato è l'unico posto da
 * cui un dato non si può più ritirare.
 */
export function avvisoConflittoNuovo(c: ConflittoSerializzato, destinatario: Destinatario): Avviso {
	const l = leggibile(c);
	const mia = c.mia;

	const testo = [
		`${titoloConflitto(l)}.`,
		'',
		`La tua data: ${mia.title} — ${giornoEsteso(mia.giorno)}, ${citta(mia)}.`,
		'',
		spiegazioneConflitto(l),
		'',
		INVITO_AL_CONTATTO
	].join('\n');

	return {
		kind: 'conflitto_nuovo',
		destinatario,
		titolo: titoloConflitto(l),
		testo,
		url: '/conflicts',
		// Un conflitto per destinatario, una volta sola. Il ricalcolo notturno
		// ripassa sulle stesse coppie ogni notte: senza questa chiave, un
		// conflitto che si riapre e si richiude riempirebbe la casella.
		dedupeKey: `conflitto_nuovo:${c.id}`
	};
}

/**
 * Un conflitto chiuso (§10, riga 2). Resta in pagina e non esce: è una buona
 * notizia, e le buone notizie non hanno bisogno di raggiungere nessuno mentre
 * è al lavoro.
 */
export function avvisoConflittoRisolto(
	c: ConflittoSerializzato,
	destinatario: Destinatario
): Avviso {
	const l = leggibile(c);
	const nota = c.resolutionNote ? `\n\nNota: ${c.resolutionNote}` : '';

	return {
		kind: 'conflitto_risolto',
		destinatario,
		titolo: 'Un conflitto è stato chiuso',
		testo:
			`${titoloConflitto(l)} — la segnalazione su ${giornoEsteso(c.mia.giorno)} ` +
			`non è più aperta.${nota}`,
		url: '/conflicts',
		dedupeKey: `conflitto_risolto:${c.id}`
	};
}

/* ------------------------------------------------------------------ *
 * Sollecito di annuncio
 * ------------------------------------------------------------------ */

/**
 * La data di annuncio è passata e la data è ancora opzionata (§10, riga 5).
 *
 * Non è un rimprovero e non chiede di confermare: una data può restare
 * opzionata per ottime ragioni, e il calendario non arbitra (ADR-0022). Dice
 * solo che quella scadenza l'aveva scritta chi legge, e che è passata.
 *
 * L'evento è per forza dell'organizzazione del destinatario — `announce_at`
 * non esce mai da lì (§5) — quindi qui non c'è niente da redigere.
 */
export function avvisoSollecito(evento: EventoCompleto, destinatario: Destinatario): Avviso {
	const previsto = evento.announceAt ? giornoEsteso(giornoCivile(evento.announceAt)) : null;

	const testo = [
		`${evento.title} — ${giornoEsteso(evento.giorno)}, ${citta(evento)}.`,
		'',
		previsto
			? `Avevi previsto di annunciarla ${previsto.toLowerCase()}, ed è passato: la data risulta ancora ${ETICHETTE_STATO.hold.toLowerCase()}.`
			: `La data risulta ancora ${ETICHETTE_STATO.hold.toLowerCase()} oltre la scadenza di annuncio che avevi indicato.`,
		'',
		'Se l’hai già annunciata altrove, qui manca solo il passaggio a confermata — che è anche ciò che la rende visibile per intero agli altri iscritti. Se invece è saltata, annullarla libera lo slot e lo dice a chi stava guardando quella sera.'
	].join('\n');

	return {
		kind: 'sollecito_annuncio',
		destinatario,
		titolo: 'Una data opzionata ha superato la scadenza di annuncio',
		testo,
		url: `/events/${evento.id}`,
		// Una volta per data. La scansione ripassa ogni notte finché la data
		// resta com'è, e senza chiave manderebbe un sollecito al giorno fino
		// alla fine dei tempi.
		dedupeKey: `sollecito:${evento.id}`
	};
}

/* ------------------------------------------------------------------ *
 * Segnalazione di una data esterna
 * ------------------------------------------------------------------ */

/**
 * Una data di un organizzatore non iscritto è entrata in calendario (ADR-0044).
 *
 * **È un avviso per conoscenza, e il testo lo dice.** Quando arriva, la data è
 * già visibile a tutti: non c'è niente da approvare, e scriverlo in modo
 * ambiguo trasformerebbe in un adempimento quotidiano ciò che ADR-0044 ha
 * deciso di non rendere tale.
 *
 * L'evento entra **già serializzato**, come ovunque in questo file. Qui la
 * redazione non toglie mai niente — una data esterna è `confirmed` o
 * `cancelled` e non appartiene a nessuno, quindi è completa per chiunque — ma
 * il tipo `EventoCompleto` è ciò che garantisce che sia passata di lì.
 */
export function avvisoSegnalazioneEsterna(
	evento: EventoCompleto,
	destinatario: Destinatario
): Avviso {
	const chiSegnala = evento.segnalataDa?.name ?? 'un iscritto';

	const testo = [
		`${evento.title} — ${giornoEsteso(evento.giorno)}, ${citta(evento)}.`,
		'',
		`Organizza ${evento.organizzazione.name}, che nel calendario non è iscritto.`,
		`La segnalazione arriva da ${chiSegnala}.`,
		'',
		'La data è già in calendario e visibile a tutti: non c’è niente da approvare. Se è sbagliata, si corregge o si cancella da qui.'
	].join('\n');

	return {
		kind: 'segnalazione_esterna',
		destinatario,
		titolo: 'Segnalata una data di un organizzatore esterno',
		testo,
		url: `/events/${evento.id}`,
		// Una per data. Nasce da un fatto puntuale e non da una scansione, ma
		// la chiave rende innocuo il doppio invio del form.
		dedupeKey: `segnalazione:${evento.id}`
	};
}

/* ------------------------------------------------------------------ *
 * Digest settimanale
 * ------------------------------------------------------------------ */

export type VoceDigest = { giorno: string; testo: string };

export type RiepilogoDigest = {
	/** Date nuove della settimana, già filtrate da ciò che il destinatario vede. */
	nuoveDate: VoceDigest[];
	/** Conflitti ancora da trattare, già redatti. */
	conflittiAperti: VoceDigest[];
	/** Proprie date opzionate con l'annuncio in scadenza o già scaduto. */
	holdInScadenza: VoceDigest[];
};

export function digestVuoto(r: RiepilogoDigest): boolean {
	return !r.nuoveDate.length && !r.conflittiAperti.length && !r.holdInScadenza.length;
}

function sezione(titolo: string, voci: VoceDigest[]): string[] {
	if (!voci.length) return [];
	return [titolo, ...voci.map((v) => `· ${giornoEsteso(v.giorno)} — ${v.testo}`), ''];
}

/**
 * Il riepilogo del lunedì mattina (§10, riga 4).
 *
 * Restituisce `null` quando non c'è niente da dire. **Un riepilogo settimanale
 * che arriva anche quando non è successo nulla insegna a non aprirlo**, e la
 * settimana in cui c'è dentro un conflitto grave finirebbe nello stesso
 * scorrimento di pollice delle altre.
 *
 * `settimana` entra nella chiave di deduplica e non nel testo: garantisce un
 * digest per settimana anche se la corsa del lunedì viene rilanciata a mano.
 */
export function avvisoDigest(
	riepilogo: RiepilogoDigest,
	destinatario: Destinatario,
	settimana: string
): Avviso | null {
	if (digestVuoto(riepilogo)) return null;

	const corpo = [
		...sezione('Conflitti da guardare', riepilogo.conflittiAperti),
		...sezione('Date nuove in calendario', riepilogo.nuoveDate),
		...sezione('Tue date opzionate con l’annuncio in scadenza', riepilogo.holdInScadenza)
	];

	return {
		kind: 'digest_settimanale',
		destinatario,
		titolo: 'Il calendario della settimana',
		testo: [`Ciao ${destinatario.displayName},`, '', ...corpo].join('\n').trimEnd(),
		url: '/calendar',
		dedupeKey: `digest:${settimana}`
	};
}
