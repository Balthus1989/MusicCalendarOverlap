/**
 * Il feed ICS (ARCHITECTURE.md §8, §15, ADR-0011, ADR-0028, ADR-0029).
 *
 * È l'uscita di dati più pericolosa del prodotto, per una ragione che non ha
 * niente a che vedere con la difficoltà tecnica: **nessuno la guarda**. Una
 * pagina sbagliata la si vede aprendola; un feed sbagliato finisce dentro
 * Google Calendar e ci resta per mesi, con il titolo di una serata che
 * qualcuno non aveva ancora annunciato.
 *
 * Per questo i test non si fermano allo snapshot. Il file viene **riletto con
 * un parser** scritto qui sotto — unfolding e unescaping compresi, che sono
 * esattamente i due punti dove una stringa può sembrare a posto e non esserlo
 * — e si verifica che certe stringhe non compaiano **da nessuna parte**
 * nell'output grezzo, non solo nei campi in cui ci si aspetterebbe di
 * trovarle.
 */
import { describe, expect, it } from 'vitest';
import {
	aVoceIcs,
	costruisciCalendario,
	nomeFileIcs,
	sequenzaDa,
	sommarioIcs,
	statoIcs
} from '../../src/lib/server/ics/build';
import type { EventWithRelations, ViewerContext } from '../../src/lib/server/visibility';
import { linkAggiungiAlCalendario } from '../../src/lib/server/ics/add-to-calendar';
import { daLocaleAIstante } from '../../src/lib/time';
import {
	AGGIORNATO,
	BASE,
	estraneo,
	proprietario as mioViewer,
	serializza
} from './fixtures/eventi';

function calendario(over: Partial<EventWithRelations>, viewer: ViewerContext): string {
	return costruisciCalendario(
		[{ evento: serializza(over, viewer), aggiornatoIl: over.updatedAt ?? AGGIORNATO }],
		{ nome: 'Prova', baseUrl: BASE }
	);
}

/* ------------------------------------------------------------------ *
 * Un parser ICS minimo, scritto qui perché è ciò che il test verifica
 * ------------------------------------------------------------------ */

/**
 * Ricompone le righe spezzate.
 *
 * RFC 5545 impone di non superare i 75 ottetti per riga e di continuare la
 * successiva con uno spazio. È il punto in cui un titolo lungo si spezza in
 * mezzo a una parola: se lo `srotola` non ricostruisce l'originale, il file è
 * rotto per qualunque client, non solo per il nostro test.
 */
function srotola(ics: string): string[] {
	const fisiche = ics.split('\r\n');
	const logiche: string[] = [];
	for (const riga of fisiche) {
		if (logiche.length && (riga.startsWith(' ') || riga.startsWith('\t'))) {
			logiche[logiche.length - 1] += riga.slice(1);
		} else {
			logiche.push(riga);
		}
	}
	return logiche.filter((r) => r !== '');
}

function disescapa(v: string): string {
	return v.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
}

type Proprieta = { nome: string; parametri: Record<string, string>; valore: string };

function leggiProprieta(riga: string): Proprieta {
	// Il separatore è il primo `:` fuori dalle virgolette: un valore di
	// parametro può contenerne uno.
	let dentroVirgolette = false;
	let taglio = -1;
	for (let i = 0; i < riga.length; i++) {
		if (riga[i] === '"') dentroVirgolette = !dentroVirgolette;
		else if (riga[i] === ':' && !dentroVirgolette) {
			taglio = i;
			break;
		}
	}
	const testa = taglio < 0 ? riga : riga.slice(0, taglio);
	const valore = taglio < 0 ? '' : riga.slice(taglio + 1);

	const [nome, ...pezzi] = testa.split(';');
	const parametri: Record<string, string> = {};
	for (const p of pezzi) {
		const eq = p.indexOf('=');
		if (eq > 0) parametri[p.slice(0, eq)] = p.slice(eq + 1).replace(/^"|"$/g, '');
	}

	return { nome, parametri, valore: disescapa(valore) };
}

type VEvent = {
	props: Proprieta[];
	get(nome: string): Proprieta | undefined;
	tutti(nome: string): Proprieta[];
};

function analizza(ics: string): { intestazione: Proprieta[]; eventi: VEvent[] } {
	const righe = srotola(ics).map(leggiProprieta);
	const intestazione: Proprieta[] = [];
	const eventi: VEvent[] = [];
	let corrente: Proprieta[] | null = null;

	for (const p of righe) {
		if (p.nome === 'BEGIN' && p.valore === 'VEVENT') {
			corrente = [];
			continue;
		}
		if (p.nome === 'END' && p.valore === 'VEVENT') {
			const props = corrente ?? [];
			eventi.push({
				props,
				get: (nome) => props.find((x) => x.nome === nome),
				tutti: (nome) => props.filter((x) => x.nome === nome)
			});
			corrente = null;
			continue;
		}
		if (corrente) corrente.push(p);
		else intestazione.push(p);
	}

	return { intestazione, eventi };
}

const valore = (e: VEvent, nome: string) => e.get(nome)?.valore;

/* ------------------------------------------------------------------ *
 * Il file è un file ICS
 * ------------------------------------------------------------------ */

describe('struttura del calendario', () => {
	it('apre e chiude un VCALENDAR con le proprietà che i client pretendono', () => {
		const ics = calendario({}, estraneo);
		const righe = srotola(ics);

		expect(righe[0]).toBe('BEGIN:VCALENDAR');
		expect(righe.at(-1)).toBe('END:VCALENDAR');
		expect(ics).toContain('VERSION:2.0');
		expect(ics).toContain('PRODID:-//calendario-eventi-condiviso//IT');
	});

	it('dichiara ogni quanto tornare a leggere, altrimenti alcuni client passano una volta al giorno', () => {
		const ics = costruisciCalendario(
			[{ evento: serializza({}, estraneo), aggiornatoIl: AGGIORNATO }],
			{
				nome: 'Tutte le date',
				baseUrl: BASE,
				sorgente: `${BASE}/api/ics/xyz.ics`
			}
		);

		expect(ics).toContain('X-WR-CALNAME:Tutte le date');
		expect(ics).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT12H');
		expect(ics).toContain('X-PUBLISHED-TTL:PT12H');
		expect(ics).toContain(`${BASE}/api/ics/xyz.ics`);
	});

	it('usa CRLF: è ciò che RFC 5545 prescrive, e ciò che Outlook pretende', () => {
		const ics = calendario({}, estraneo);
		expect(ics).toContain('\r\n');
		// Nessun LF orfano: se ce ne fosse uno, `split('\r\n')` lo lascerebbe
		// attaccato alla riga e il parser leggerebbe una proprietà sbagliata.
		expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
	});

	it('non supera i 75 ottetti per riga fisica, e si ricompone senza perdere niente', () => {
		const lunga = 'Serata lunghissima con un titolo che non sta in una riga sola '.repeat(4);
		const ics = calendario({ title: lunga }, estraneo);

		for (const riga of ics.split('\r\n')) {
			expect(new TextEncoder().encode(riga).length).toBeLessThanOrEqual(75);
		}

		const [ev] = analizza(ics).eventi;
		expect(valore(ev, 'SUMMARY')).toBe(lunga);
	});
});

/* ------------------------------------------------------------------ *
 * La matrice di visibilità vale anche qui
 * ------------------------------------------------------------------ */

describe('visibilità nel feed', () => {
	it('una data confermata altrui esce per intero, con locale, coordinate e generi', () => {
		const [ev] = analizza(calendario({}, estraneo)).eventi;

		expect(valore(ev, 'SUMMARY')).toBe('Notte di Death Metal');
		expect(valore(ev, 'STATUS')).toBe('CONFIRMED');
		expect(valore(ev, 'LOCATION')).toContain('Circolo Arci Il Grifo');
		expect(valore(ev, 'GEO')).toBe('43.1107;12.3908');
		expect(valore(ev, 'CATEGORIES')).toContain('Death Metal');
		expect(valore(ev, 'CATEGORIES')).toContain('Grindcore');
		expect(valore(ev, 'URL')).toBe(`${BASE}/events/e1111111-0000-0000-0000-000000000000`);
	});

	it('una data opzionata altrui diventa una giornata intera senza orario', () => {
		const ics = calendario({ status: 'hold' }, estraneo);
		const [ev] = analizza(ics).eventi;

		expect(ev.get('DTSTART')?.parametri.VALUE).toBe('DATE');
		expect(valore(ev, 'DTSTART')).toBe('20261012');
		// `DTEND` è esclusivo: il giorno dopo, non lo stesso giorno.
		expect(valore(ev, 'DTEND')).toBe('20261013');
		expect(valore(ev, 'STATUS')).toBe('TENTATIVE');
		expect(valore(ev, 'SUMMARY')).toBe('Opzionata · Death Metal · Associazione X');
	});

	it('di una data opzionata altrui non escono titolo, locale, orario né generi secondari', () => {
		const ics = calendario({ status: 'hold' }, estraneo);

		// Sull'output **grezzo**, non sui campi: è l'unico modo di accorgersi
		// se un dato riservato fosse finito in una proprietà inattesa.
		expect(ics).not.toContain('Notte di Death Metal');
		expect(ics).not.toContain('Circolo Arci Il Grifo');
		expect(ics).not.toContain('Via dei Priori');
		expect(ics).not.toContain('Grindcore');
		expect(ics).not.toContain('T220000');
		expect(ics).not.toContain('GEO:');
	});

	it('la lineup non annunciata non compare, in nessuno stato — annullato compreso', () => {
		for (const status of ['confirmed', 'cancelled', 'hold'] as const) {
			const ics = calendario({ status }, estraneo);
			expect(ics, `stato ${status}`).not.toContain('Ossario Lucente');
		}
	});

	it('la propria organizzazione vede tutto, note interne escluse', () => {
		// Le note interne non escono nemmeno alla propria organizzazione: non
		// perché siano segrete a chi le ha scritte, ma perché un feed ICS
		// finisce su server altrui, e `serializeEvent` non le mette in nessun
		// campo che questo modulo sappia leggere.
		const ics = calendario({ status: 'hold' }, mioViewer);

		expect(ics).toContain('Notte di Death Metal');
		expect(ics).toContain('Ossario Lucente');
		expect(ics).not.toContain('Cachet 800');
	});

	it('una data annullata resta nel feed, con lo stato che lo dice', () => {
		const [ev] = analizza(calendario({ status: 'cancelled' }, estraneo)).eventi;

		expect(valore(ev, 'STATUS')).toBe('CANCELLED');
		// Sparire dal feed cancellerebbe la data dal calendario di chi l'aveva
		// segnata, senza dirgli perché. Lo slot liberato è un'informazione.
		expect(valore(ev, 'SUMMARY')).toBe('Annullata · Notte di Death Metal');
	});

	it('la descrizione di una data opzionata spiega perché è vuota', () => {
		const [ev] = analizza(calendario({ status: 'hold' }, estraneo)).eventi;
		const descrizione = valore(ev, 'DESCRIPTION') ?? '';

		expect(descrizione).toContain('non ancora annunciata');
		expect(descrizione).toContain('info@associazione-x.example');
	});
});

/* ------------------------------------------------------------------ *
 * SEQUENCE (ADR-0028)
 * ------------------------------------------------------------------ */

describe('SEQUENCE', () => {
	it('cresce a ogni modifica: è l’unico modo perché Google si accorga di un cambiamento', () => {
		const prima = sequenzaDa(daLocaleAIstante('2026-09-01T10:30'));
		const dopo = sequenzaDa(daLocaleAIstante('2026-09-01T10:31'));
		expect(dopo).toBeGreaterThan(prima);
	});

	it('resta un intero a 32 bit, che è ciò che RFC 5545 ammette', () => {
		expect(sequenzaDa(new Date('2090-01-01T00:00:00Z'))).toBeLessThanOrEqual(2_147_483_647);
		expect(Number.isInteger(sequenzaDa(AGGIORNATO))).toBe(true);
	});

	it('non va mai sotto zero, nemmeno per una riga più vecchia dell’origine', () => {
		expect(sequenzaDa(new Date('2001-01-01T00:00:00Z'))).toBe(0);
	});

	it('finisce nel file, accanto a un UID stabile', () => {
		const [ev] = analizza(calendario({}, estraneo)).eventi;

		expect(valore(ev, 'UID')).toBe('e1111111-0000-0000-0000-000000000000@calendario.example');
		expect(Number(valore(ev, 'SEQUENCE'))).toBe(sequenzaDa(AGGIORNATO));
		// `DTSTAMP` dalla stessa fonte: a parità di dati il file è identico, e
		// un client che confronta i byte non vede modifiche che non ci sono.
		expect(valore(ev, 'DTSTAMP')).toBe('20260901T083000Z');
	});

	it('non passa dal serializzatore: `updatedAt` non è un campo dell’evento', () => {
		const serializzato = serializza({}, mioViewer);
		expect(serializzato).not.toHaveProperty('updatedAt');
	});
});

/* ------------------------------------------------------------------ *
 * Escaping, orari, dettagli
 * ------------------------------------------------------------------ */

describe('dettagli del formato', () => {
	it('protegge virgole, punti e virgola e a capo, e li restituisce identici', () => {
		const titolo = 'Serata, con virgola; e punto e virgola\ne un a capo';
		const [ev] = analizza(calendario({ title: titolo }, estraneo)).eventi;
		expect(valore(ev, 'SUMMARY')).toBe(titolo);
	});

	it('scrive gli istanti in UTC: un concerto italiano non deve dipendere dal fuso del client', () => {
		const [ev] = analizza(calendario({}, estraneo)).eventi;
		// 22:00 in Italia a ottobre è ancora ora legale: 20:00 UTC.
		expect(valore(ev, 'DTSTART')).toBe('20261012T200000Z');
		expect(valore(ev, 'DTEND')).toBe('20261013T000000Z');
	});

	it('con `ends_at` nullo assume quattro ore, come il motore conflitti', () => {
		const [ev] = analizza(calendario({ endsAt: null }, estraneo)).eventi;
		expect(valore(ev, 'DTEND')).toBe('20261013T000000Z');
	});

	it('mappa gli stati sui tre valori che iCalendar conosce', () => {
		expect(statoIcs('hold')).toBe('TENTATIVE');
		expect(statoIcs('draft')).toBe('TENTATIVE');
		expect(statoIcs('confirmed')).toBe('CONFIRMED');
		expect(statoIcs('cancelled')).toBe('CANCELLED');
	});

	it('etichetta lo stato nel titolo solo quando non è confermato', () => {
		expect(sommarioIcs(serializza({}, estraneo))).toBe('Notte di Death Metal');
		expect(sommarioIcs(serializza({ status: 'hold' }, mioViewer))).toBe(
			'Opzionata · Notte di Death Metal'
		);
	});

	it('senza locale ripiega sulla città, e non inventa coordinate', () => {
		const ics = calendario({ venueId: null, venue: null, lat: null, lon: null }, estraneo);
		const [ev] = analizza(ics).eventi;

		expect(valore(ev, 'LOCATION')).toBe('Perugia (PG)');
		expect(ev.get('GEO')).toBeUndefined();
	});

	it('nomina il file scaricato con il giorno davanti, così si ordinano da soli', () => {
		expect(nomeFileIcs(serializza({}, estraneo))).toBe('2026-10-12-notte-di-death-metal.ics');
	});

	it('un calendario vuoto resta un calendario valido', () => {
		const ics = costruisciCalendario([], { nome: 'Vuoto', baseUrl: BASE });
		const analizzato = analizza(ics);

		expect(analizzato.eventi).toHaveLength(0);
		expect(srotola(ics)[0]).toBe('BEGIN:VCALENDAR');
	});

	it('la voce costruita è la stessa che finisce nel file', () => {
		// `aVoceIcs` è la funzione che i test di cui sopra esercitano
		// indirettamente: qui si controlla che sia davvero lei a decidere.
		const voce = aVoceIcs(
			{ evento: serializza({}, estraneo), aggiornatoIl: AGGIORNATO },
			{ nome: 'Prova', baseUrl: BASE }
		);
		expect(voce.summary).toBe('Notte di Death Metal');
		expect(voce.sequence).toBe(sequenzaDa(AGGIORNATO));
	});
});

/* ------------------------------------------------------------------ *
 * Snapshot (§15)
 * ------------------------------------------------------------------ */

describe('snapshot', () => {
	it('il feed di un estraneo, con una confermata e una opzionata', () => {
		const ics = costruisciCalendario(
			[
				{ evento: serializza({}, estraneo), aggiornatoIl: AGGIORNATO },
				{
					evento: serializza(
						{
							id: 'e2222222-0000-0000-0000-000000000000',
							status: 'hold',
							title: 'Da non rivelare',
							startsAt: daLocaleAIstante('2026-10-20T21:30')
						},
						estraneo
					),
					aggiornatoIl: daLocaleAIstante('2026-09-02T09:00')
				}
			],
			{ nome: 'Tutte le date', baseUrl: BASE, sorgente: `${BASE}/api/ics/xyz.ics` }
		);

		expect(ics).toMatchSnapshot();
	});
});

/* ------------------------------------------------------------------ *
 * Link "aggiungi al calendario" (§8)
 * ------------------------------------------------------------------ */

describe('link aggiungi al calendario', () => {
	it('compone il template di Google con orario e fuso italiano', () => {
		const { google } = linkAggiungiAlCalendario(serializza({}, estraneo), BASE);
		const u = new URL(google);

		expect(u.origin + u.pathname).toBe('https://calendar.google.com/calendar/render');
		expect(u.searchParams.get('action')).toBe('TEMPLATE');
		expect(u.searchParams.get('text')).toBe('Notte di Death Metal');
		expect(u.searchParams.get('dates')).toBe('20261012T200000Z/20261013T000000Z');
		expect(u.searchParams.get('ctz')).toBe('Europe/Rome');
		expect(u.searchParams.get('location')).toContain('Circolo Arci Il Grifo');
	});

	it('compone il deeplink di Outlook con gli stessi dati', () => {
		const { outlook } = linkAggiungiAlCalendario(serializza({}, estraneo), BASE);
		const u = new URL(outlook);

		expect(u.searchParams.get('rru')).toBe('addevent');
		expect(u.searchParams.get('subject')).toBe('Notte di Death Metal');
		expect(u.searchParams.get('startdt')).toBe('2026-10-12T20:00:00.000Z');
	});

	it('di una data opzionata altrui fa una giornata intera, senza titolo né locale', () => {
		const { google, outlook } = linkAggiungiAlCalendario(
			serializza({ status: 'hold' }, estraneo),
			BASE
		);

		expect(new URL(google).searchParams.get('dates')).toBe('20261012/20261013');
		expect(new URL(outlook).searchParams.get('allday')).toBe('true');

		for (const link of [google, outlook]) {
			expect(link).not.toContain('Notte');
			expect(link).not.toContain('Grifo');
			expect(link).not.toContain('Ossario');
		}
	});
});
