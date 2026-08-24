/**
 * Lettura di un `.ics` (ARCHITECTURE.md §9, Fase 5).
 *
 * I casi che contano sono due, e sono i due in cui un errore non si vede: i
 * **fusi**, dove una data giusta finisce due ore più in là senza che nessuno
 * riapra il form, e le **giornate intere**, dove `DTEND` è esclusivo e usarlo
 * alla lettera allunga ogni concerto di un giorno.
 */
import { describe, expect, it } from 'vitest';
import {
	istanteDa,
	leggiIcs,
	leggiLuogo,
	leggiRiga,
	sciogli,
	sembraIcs,
	srotola
} from '../../src/lib/server/parse/ics';

function calendario(vevent: string): string {
	return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', vevent, 'END:VEVENT', 'END:VCALENDAR']
		.join('\r\n')
		.concat('\r\n');
}

describe('srotolamento delle righe', () => {
	it('ricompone una riga spezzata secondo RFC 5545', () => {
		// Si toglie **solo** il carattere di piegatura e si congiunge: lo
		// spazio che serve, se serve, sta già nel testo prima della piega. Un
		// srotolamento che aggiunge uno spazio di suo spezza ogni parola su cui
		// è caduta la piega, e sono le parole lunghe — cioè i nomi delle band.
		const testo = 'DESCRIPTION:Prima parte \r\n e seconda parte\r\n  che continua';
		expect(srotola(testo)).toEqual(['DESCRIPTION:Prima parte e seconda parte che continua']);
	});

	it('accetta la tabulazione come continuazione, non solo lo spazio', () => {
		expect(srotola('SUMMARY:Serata Bassa\r\n\t Marea')).toEqual(['SUMMARY:Serata Bassa Marea']);
	});

	it('non inventa lo spazio: una parola piegata a metà si ricompone intera', () => {
		expect(srotola('SUMMARY:Fran\r\n kenstein')).toEqual(['SUMMARY:Frankenstein']);
	});

	it('non considera continuazione una riga nuova che comincia per lettera', () => {
		expect(srotola('SUMMARY:A\r\nLOCATION:B')).toEqual(['SUMMARY:A', 'LOCATION:B']);
	});
});

describe('lettura di una riga', () => {
	it('separa nome, parametri e valore', () => {
		expect(leggiRiga('DTSTART;TZID=Europe/Rome:20261012T220000')).toEqual({
			nome: 'DTSTART',
			parametri: { TZID: 'Europe/Rome' },
			valore: '20261012T220000'
		});
	});

	it('non taglia sui due punti dentro un parametro fra virgolette', () => {
		// Un `TZID="GMT+01:00"` ne contiene uno: tagliare sul primo spezzerebbe
		// il parametro invece del valore, e la data diventerebbe illeggibile.
		const r = leggiRiga('DTSTART;TZID="GMT+01:00":20261012T220000');
		expect(r?.parametri.TZID).toBe('GMT+01:00');
		expect(r?.valore).toBe('20261012T220000');
	});

	it('scioglie gli a-capo di una DESCRIPTION', () => {
		expect(sciogli('Prima\\nSeconda\\, con virgola')).toBe('Prima\nSeconda, con virgola');
	});
});

describe('istanti', () => {
	const riga = (s: string) => leggiRiga(s)!;

	it('rende un istante UTC nel fuso italiano, in ora legale', () => {
		// 20:00 UTC il 12 ottobre = 22:00 a Roma (CEST, +2).
		expect(istanteDa(riga('DTSTART:20261012T200000Z'))).toEqual({
			tipo: 'orario',
			locale: '2026-10-12T22:00'
		});
	});

	it('rende un istante UTC nel fuso italiano, in ora solare', () => {
		// 21:00 UTC l'8 dicembre = 22:00 a Roma (CET, +1).
		expect(istanteDa(riga('DTSTART:20261208T210000Z'))).toEqual({
			tipo: 'orario',
			locale: '2026-12-08T22:00'
		});
	});

	it('prende alla lettera un orario già dichiarato nel fuso italiano', () => {
		expect(istanteDa(riga('DTSTART;TZID=Europe/Rome:20261012T220000'))).toEqual({
			tipo: 'orario',
			locale: '2026-10-12T22:00'
		});
	});

	it('converte un orario di parete di un altro fuso', () => {
		// Le 22:00 a Berlino sono le 22:00 a Roma: stesso fuso, prova di
		// controllo. Londra invece è un'ora indietro.
		expect(istanteDa(riga('DTSTART;TZID=Europe/London:20261012T210000'))).toEqual({
			tipo: 'orario',
			locale: '2026-10-12T22:00'
		});
	});

	it('prende alla lettera un TZID che non esiste, invece di perdere la data', () => {
		expect(istanteDa(riga('DTSTART;TZID=W. Europe Standard Time:20261012T220000'))).toEqual({
			tipo: 'orario',
			locale: '2026-10-12T22:00'
		});
	});

	it("prende alla lettera l'ora fluttuante, senza interpretarla come UTC", () => {
		expect(istanteDa(riga('DTSTART:20261012T220000'))).toEqual({
			tipo: 'orario',
			locale: '2026-10-12T22:00'
		});
	});

	it('riconosce una giornata intera', () => {
		expect(istanteDa(riga('DTSTART;VALUE=DATE:20261012'))).toEqual({
			tipo: 'giornata',
			giorno: '2026-10-12'
		});
	});
});

describe('il luogo', () => {
	it('scioglie la forma che scrive il nostro export', () => {
		expect(leggiLuogo('Circolo Arci Lupo Bianco, Via Roma 1, 06121 Perugia PG')).toEqual({
			venueName: 'Circolo Arci Lupo Bianco',
			address: 'Via Roma 1, 06121 Perugia PG',
			city: 'Perugia',
			province: 'PG'
		});
	});

	it('tiene la città anche senza sigla di provincia', () => {
		const l = leggiLuogo('Teatro Comunale, Piazza Grande 2, 40121 Bologna');
		expect(l.city).toBe('Bologna');
		expect(l.province).toBeNull();
	});

	it('non indovina la città quando non c’è: meglio un campo vuoto', () => {
		expect(leggiLuogo('Al capannone dietro la stazione')).toEqual({
			venueName: 'Al capannone dietro la stazione',
			address: null,
			city: null,
			province: null
		});
	});
});

describe('lettura completa', () => {
	it('riconosce un calendario', () => {
		expect(sembraIcs('BEGIN:VCALENDAR\r\nEND:VCALENDAR')).toBe(true);
		expect(sembraIcs('Sabato 12 ottobre al Lupo Bianco')).toBe(false);
	});

	it('legge un evento intero', () => {
		const { bersaglio } = leggiIcs(
			calendario(
				[
					'SUMMARY:Serata Bassa Marea',
					'DTSTART;TZID=Europe/Rome:20261012T220000',
					'DTEND;TZID=Europe/Rome:20261013T010000',
					'LOCATION:Circolo Arci Lupo Bianco\\, Via Roma 1\\, 06121 Perugia PG',
					'CATEGORIES:Punk,Hardcore',
					'DESCRIPTION:Tre band\\nIngresso 8 euro',
					'URL:https://example.org/serata'
				].join('\r\n')
			)
		);

		expect(bersaglio.title).toBe('Serata Bassa Marea');
		expect(bersaglio.startsAtLocal).toBe('2026-10-12T22:00');
		expect(bersaglio.endsAtLocal).toBe('2026-10-13T01:00');
		expect(bersaglio.venueName).toBe('Circolo Arci Lupo Bianco');
		expect(bersaglio.city).toBe('Perugia');
		expect(bersaglio.province).toBe('PG');
		expect(bersaglio.genres).toEqual(['Punk', 'Hardcore']);
		expect(bersaglio.description).toBe('Tre band\nIngresso 8 euro');
		expect(bersaglio.externalUrl).toBe('https://example.org/serata');
	});

	it('su una giornata intera tiene il giorno e dice che l’ora manca', () => {
		const { bersaglio } = leggiIcs(
			calendario(
				['SUMMARY:Festival', 'DTSTART;VALUE=DATE:20261012', 'DTEND;VALUE=DATE:20261013'].join(
					'\r\n'
				)
			)
		);

		expect(bersaglio.startsAtLocal).toBe('2026-10-12T00:00');
		// `DTEND` esclusivo: usarlo come fine allungherebbe il concerto di un
		// giorno intero. Si scarta, e lo si dice.
		expect(bersaglio.endsAtLocal).toBeNull();
		expect(bersaglio.incerti.join(' ')).toMatch(/giornata intera/i);
		expect(bersaglio.incerti.join(' ')).toMatch(/intera giornata/i);
	});

	it('legge il primo evento e conta gli altri', () => {
		const testo = [
			'BEGIN:VCALENDAR',
			'BEGIN:VEVENT',
			'SUMMARY:Prima',
			'DTSTART:20261012T220000',
			'END:VEVENT',
			'BEGIN:VEVENT',
			'SUMMARY:Seconda',
			'DTSTART:20261019T220000',
			'END:VEVENT',
			'END:VCALENDAR'
		].join('\r\n');

		const esito = leggiIcs(testo);
		expect(esito.bersaglio.title).toBe('Prima');
		expect(esito.totaleEventi).toBe(2);
	});

	it('lo dice quando non c’è nessun evento, invece di restituire un guscio vuoto', () => {
		const esito = leggiIcs('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR');
		expect(esito.totaleEventi).toBe(0);
		expect(esito.bersaglio.incerti).toHaveLength(1);
	});

	it('nessuna riga di lineup: un ICS non la modella', () => {
		const { bersaglio } = leggiIcs(calendario('SUMMARY:X\r\nDTSTART:20261012T220000'));
		expect(bersaglio.lineup).toEqual([]);
	});
});
