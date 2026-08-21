/**
 * Il fuso è la parte che sembra banale e non lo è: due volte l'anno lo scarto
 * cambia, e una data sbagliata di un'ora sposta il giorno civile su cui si
 * calcolano i conflitti (ARCHITECTURE.md §16).
 */
import { describe, expect, it } from 'vitest';
import {
	aLocaleInput,
	daLocaleAIstante,
	distanzaInGiorniCivili,
	fineEffettiva,
	giornoCivile,
	oraCivile
} from '../../src/lib/time';

describe('da orario di parete a istante', () => {
	it('interpreta l’ora solare come UTC+1', () => {
		// 12 gennaio, ora solare: Roma è UTC+1.
		expect(daLocaleAIstante('2026-01-12T22:00').toISOString()).toBe('2026-01-12T21:00:00.000Z');
	});

	it('interpreta l’ora legale come UTC+2', () => {
		// 12 luglio, ora legale: Roma è UTC+2.
		expect(daLocaleAIstante('2026-07-12T22:00').toISOString()).toBe('2026-07-12T20:00:00.000Z');
	});

	it('gestisce il concerto a cavallo del passaggio all’ora legale', () => {
		// Ultima domenica di marzo 2026: il 29. Alle 02:00 locali si salta
		// alle 03:00. Le 23:00 del 28 sono ancora ora solare.
		expect(daLocaleAIstante('2026-03-28T23:00').toISOString()).toBe('2026-03-28T22:00:00.000Z');
		// Le 04:00 del 29 sono già ora legale.
		expect(daLocaleAIstante('2026-03-29T04:00').toISOString()).toBe('2026-03-29T02:00:00.000Z');
	});

	it('gestisce il ritorno all’ora solare', () => {
		// Ultima domenica di ottobre 2026: il 25.
		expect(daLocaleAIstante('2026-10-24T22:00').toISOString()).toBe('2026-10-24T20:00:00.000Z');
		expect(daLocaleAIstante('2026-10-25T22:00').toISOString()).toBe('2026-10-25T21:00:00.000Z');
	});

	it('accetta una data senza ora, e la mette a mezzanotte locale', () => {
		expect(daLocaleAIstante('2026-01-12').toISOString()).toBe('2026-01-11T23:00:00.000Z');
	});

	it('fa andata e ritorno senza perdere niente', () => {
		for (const locale of [
			'2026-01-12T22:00',
			'2026-07-12T22:00',
			'2026-03-29T04:00',
			'2026-10-25T22:00',
			'2026-12-31T23:59'
		]) {
			expect(aLocaleInput(daLocaleAIstante(locale))).toBe(locale);
		}
	});
});

describe('giorno civile', () => {
	it('attribuisce alla serata precedente ciò che inizia dopo mezzanotte', () => {
		// Un after alle 01:00 del 13 è la serata del 12 per chi la organizza —
		// ma il giorno civile resta il 13: è la data, non la percezione.
		// Questo test fissa il comportamento, non lo giustifica.
		const istante = daLocaleAIstante('2026-10-13T01:00');
		expect(giornoCivile(istante)).toBe('2026-10-13');
	});

	it('non slitta di un giorno vicino alla mezzanotte in ora legale', () => {
		// 23:30 del 12 luglio è 21:30 UTC: in UTC sarebbe ancora il 12, ma il
		// caso opposto (00:30 del 13) in UTC è il 12 e va attribuito al 13.
		expect(giornoCivile(daLocaleAIstante('2026-07-12T23:30'))).toBe('2026-07-12');
		expect(giornoCivile(daLocaleAIstante('2026-07-13T00:30'))).toBe('2026-07-13');
	});

	it('legge l’ora di parete, non quella UTC', () => {
		expect(oraCivile(new Date('2026-07-12T20:00:00.000Z'))).toBe('22:00');
		expect(oraCivile(new Date('2026-01-12T21:00:00.000Z'))).toBe('22:00');
	});
});

describe('fine effettiva', () => {
	it('assume quattro ore quando ends_at manca', () => {
		const inizio = new Date('2026-07-12T20:00:00.000Z');
		expect(fineEffettiva(inizio, null).toISOString()).toBe('2026-07-13T00:00:00.000Z');
	});

	it('rispetta ends_at quando c’è', () => {
		const inizio = new Date('2026-07-12T20:00:00.000Z');
		const fine = new Date('2026-07-12T21:30:00.000Z');
		expect(fineEffettiva(inizio, fine)).toBe(fine);
	});
});

describe('valore vuoto', () => {
	it('un istante nullo diventa stringa vuota per il form', () => {
		expect(aLocaleInput(null)).toBe('');
	});
});

describe('distanza in giorni civili', () => {
	it('due date nello stesso giorno distano zero', () => {
		expect(
			distanzaInGiorniCivili(
				daLocaleAIstante('2026-10-12T09:00'),
				daLocaleAIstante('2026-10-12T23:59')
			)
		).toBe(0);
	});

	it('è sempre positiva, in qualunque ordine arrivino', () => {
		const a = daLocaleAIstante('2026-10-12T22:00');
		const b = daLocaleAIstante('2026-10-19T22:00');
		expect(distanzaInGiorniCivili(a, b)).toBe(7);
		expect(distanzaInGiorniCivili(b, a)).toBe(7);
	});

	it('un’ora di distanza a cavallo della mezzanotte è un giorno', () => {
		// La regola R2 conta serate, non ore: le 23:30 e le 00:30 sono due
		// date diverse per chiunque le organizzi.
		expect(
			distanzaInGiorniCivili(
				daLocaleAIstante('2026-10-12T23:30'),
				daLocaleAIstante('2026-10-13T00:30')
			)
		).toBe(1);
	});

	it('la domenica da 25 ore resta a un giorno dal sabato', () => {
		// ADR-0021 lo dice esplicitamente: il giorno di distanza si conta fra
		// giorni civili, non dividendo i millisecondi per 86.400.000. Il 25
		// ottobre 2026 finisce l'ora legale e quella domenica dura 25 ore:
		// con la divisione, queste due date risulterebbero a 1,04 giorni —
		// che arrotondato per difetto diventa zero, cioè "stessa sera".
		const sabato = daLocaleAIstante('2026-10-24T23:00');
		const domenica = daLocaleAIstante('2026-10-25T23:30');
		expect(distanzaInGiorniCivili(sabato, domenica)).toBe(1);
		// La controprova: la divisione ingenua darebbe meno di un giorno.
		expect((domenica.getTime() - sabato.getTime()) / 86_400_000).toBeGreaterThan(1);
	});

	it('la domenica da 23 ore resta a un giorno dal sabato', () => {
		// L'altro cambio, in marzo: qui la divisione darebbe 0,96 giorni.
		const sabato = daLocaleAIstante('2026-03-28T22:00');
		const domenica = daLocaleAIstante('2026-03-29T21:00');
		expect(distanzaInGiorniCivili(sabato, domenica)).toBe(1);
		expect((domenica.getTime() - sabato.getTime()) / 86_400_000).toBeLessThan(1);
	});

	it('conta i giorni anche a cavallo di un cambio di mese e di anno', () => {
		expect(
			distanzaInGiorniCivili(
				daLocaleAIstante('2026-12-30T22:00'),
				daLocaleAIstante('2027-01-02T22:00')
			)
		).toBe(3);
	});
});
