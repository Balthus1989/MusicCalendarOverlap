/**
 * Link "aggiungi al calendario" per Google e Outlook Web (ARCHITECTURE.md §8).
 *
 * Sono l'alternativa a un click sul download `.ics` per chi vive dentro il
 * browser: aprono il form di creazione evento del proprio calendario già
 * compilato. Non pubblicano niente e non chiedono nessun permesso — è una
 * query string, non un'integrazione (ADR-0011).
 *
 * Generati **lato server**, come prescrive §8, e a partire da un evento già
 * serializzato: gli stessi campi del feed, con le stesse regole di visibilità.
 * Un link costruito nel componente leggerebbe prima o poi da una riga grezza.
 */
import { fineEffettiva } from '$lib/time';
import type { EventoSerializzato } from '$lib/server/visibility';
import { sommarioIcs } from './build';

export type LinkCalendario = { google: string; outlook: string };

/** `YYYYMMDDTHHMMSSZ`, il formato che entrambi i servizi si aspettano. */
function istanteCompatto(d: Date): string {
	return d
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}/, '');
}

/** `YYYYMMDD`, per gli eventi di giornata intera. */
function giornoCompatto(giorno: string): string {
	return giorno.replace(/-/g, '');
}

function luogo(evento: EventoSerializzato): string {
	const completo = evento.visibilita === 'completa' ? evento : null;
	const citta = evento.province ? `${evento.city} (${evento.province})` : evento.city;
	const venue = completo?.venue;
	if (!venue) return citta;
	return [venue.name, venue.address, citta].filter(Boolean).join(', ');
}

/**
 * Descrizione breve: qui non si replica quella del feed.
 *
 * Finisce in una query string, e Google tronca gli URL lunghi senza avvisare.
 * Il link alla pagina è la cosa che serve davvero, perché da lì si vede tutto
 * il resto sempre aggiornato.
 */
function descrizione(evento: EventoSerializzato, baseUrl: string): string {
	const righe = [
		evento.visibilita === 'completa'
			? `Organizza: ${evento.organizzazione.name}`
			: `Data opzionata da ${evento.organizzazione.name}, non ancora annunciata.`,
		`${baseUrl}/events/${evento.id}`
	];
	return righe.join('\n');
}

/**
 * I due link per una data.
 *
 * Un evento in visibilità ridotta non ha un orario da mettere in un link:
 * diventa una giornata intera, esattamente come nel feed.
 */
export function linkAggiungiAlCalendario(
	evento: EventoSerializzato,
	baseUrl: string
): LinkCalendario {
	const completo = evento.visibilita === 'completa' ? evento : null;
	const titolo = sommarioIcs(evento);
	const dove = luogo(evento);
	const testo = descrizione(evento, baseUrl);

	const google = new URL('https://calendar.google.com/calendar/render');
	google.searchParams.set('action', 'TEMPLATE');
	google.searchParams.set('text', titolo);
	google.searchParams.set('location', dove);
	google.searchParams.set('details', testo);
	google.searchParams.set('ctz', 'Europe/Rome');

	const outlook = new URL('https://outlook.office.com/calendar/0/deeplink/compose');
	outlook.searchParams.set('path', '/calendar/action/compose');
	outlook.searchParams.set('rru', 'addevent');
	outlook.searchParams.set('subject', titolo);
	outlook.searchParams.set('location', dove);
	outlook.searchParams.set('body', testo);

	if (completo) {
		const fine = fineEffettiva(completo.startsAt, completo.endsAt);
		google.searchParams.set(
			'dates',
			`${istanteCompatto(completo.startsAt)}/${istanteCompatto(fine)}`
		);
		outlook.searchParams.set('startdt', completo.startsAt.toISOString());
		outlook.searchParams.set('enddt', fine.toISOString());
	} else {
		const inizio = new Date(`${evento.giorno}T00:00:00Z`);
		const fine = new Date(inizio.getTime() + 86_400_000);
		// Giornata intera: Google vuole due date nude, la seconda esclusiva.
		google.searchParams.set(
			'dates',
			`${giornoCompatto(evento.giorno)}/${giornoCompatto(fine.toISOString().slice(0, 10))}`
		);
		outlook.searchParams.set('allday', 'true');
		outlook.searchParams.set('startdt', evento.giorno);
		outlook.searchParams.set('enddt', fine.toISOString().slice(0, 10));
	}

	return { google: google.toString(), outlook: outlook.toString() };
}
