/**
 * Export CSV (ARCHITECTURE.md §8).
 *
 * Una riga per evento, lineup concatenata: è il formato di chi lavora in un
 * foglio di calcolo, non un formato di interscambio. Per il reimport c'è il
 * JSON, che non perde la struttura.
 *
 * Due scelte che sembrano dettagli e non lo sono:
 *
 * - **si cita sempre**, non solo quando servirebbe. Il quoting condizionale è
 *   corretto e imprevedibile da leggere: basta un titolo con una virgola
 *   perché due righe dello stesso file abbiano forma diversa;
 * - **si apre con il BOM UTF-8.** Excel, aprendo un CSV senza BOM, assume la
 *   codepage di sistema e trasforma "Città" in "CittÃ ". È il primo cosa che
 *   si vede aprendo l'export, e fa sembrare rotto tutto il resto.
 *
 * Le date sono in orario di parete italiano, non in ISO con la Z: in un foglio
 * di calcolo servono a leggere, e "22:00" è l'ora del concerto.
 */
import { giornoCivile, oraCivile } from '$lib/time';
import { ETICHETTE_STATO } from '$lib/events';
import type { EventoSerializzato } from '$lib/server/visibility';

export const BOM_UTF8 = '﻿';

export const COLONNE = [
	'id',
	'stato',
	'visibilita',
	'giorno',
	'ora_inizio',
	'ora_fine',
	'titolo',
	'organizzazione',
	'citta',
	'provincia',
	'locale',
	'indirizzo',
	'lat',
	'lon',
	'genere_principale',
	'generi',
	'lineup',
	'ingresso_libero',
	'prezzo_prevendita',
	'prezzo_porta',
	'valuta',
	'ticket_url',
	'url'
] as const;

/**
 * Una cella CSV secondo RFC 4180: sempre fra virgolette, virgolette interne
 * raddoppiate. Un `a capo` dentro una cella è lecito proprio grazie a questo.
 */
function cella(v: unknown): string {
	if (v === null || v === undefined) return '""';
	return `"${String(v).replace(/"/g, '""')}"`;
}

const si = (b: boolean) => (b ? 'sì' : 'no');

function rigaDi(e: EventoSerializzato, baseUrl: string): string[] {
	const completo = e.visibilita === 'completa' ? e : null;

	return [
		e.id,
		ETICHETTE_STATO[e.status],
		e.visibilita,
		e.giorno,
		completo ? oraCivile(completo.startsAt) : '',
		completo?.endsAt ? oraCivile(completo.endsAt) : '',
		// Di una data opzionata altrui il titolo non esiste, e non va inventato:
		// una cella vuota dice il vero, "Senza titolo" no.
		completo?.title ?? '',
		e.organizzazione.name,
		e.city,
		e.province ?? '',
		completo?.venue?.name ?? '',
		completo?.venue?.address ?? '',
		completo?.lat ?? '',
		completo?.lon ?? '',
		e.generePrimario?.name ?? '',
		completo ? completo.generi.map((g) => g.name).join(' · ') : '',
		// La lineup che arriva qui è già solo quella annunciata, fuori
		// dall'organizzazione proprietaria (ADR-0020).
		completo ? completo.lineup.map((v) => v.nome).join(' · ') : '',
		completo ? si(completo.isFree) : '',
		completo?.pricePresale ?? '',
		completo?.priceDoor ?? '',
		completo?.currency ?? '',
		completo?.ticketUrl ?? '',
		`${baseUrl}/events/${e.id}`
	].map(String);
}

export function esportaCsv(eventi: EventoSerializzato[], opzioni: { baseUrl: string }): string {
	const righe = [
		COLONNE.map(cella).join(','),
		...eventi.map((e) => rigaDi(e, opzioni.baseUrl).map(cella).join(','))
	];
	// CRLF: è ciò che prescrive RFC 4180 ed è ciò che Excel su Windows si
	// aspetta. Un file con solo LF si apre lo stesso, ma non sempre.
	return BOM_UTF8 + righe.join('\r\n') + '\r\n';
}

/** Nome file dell'export, con la finestra dentro: se ne scaricano diversi. */
export function nomeFileExport(estensione: string, da: Date, a: Date): string {
	return `calendario-${giornoCivile(da)}_${giornoCivile(a)}.${estensione}`;
}
