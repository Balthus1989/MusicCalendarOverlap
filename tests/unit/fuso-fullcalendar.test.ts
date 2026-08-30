/**
 * Il fuso, dal lato di FullCalendar.
 *
 * `timeZone: 'Europe/Rome'` senza un `namedTimeZonedImpl` non è un errore: è
 * un calendario che disegna tutto in UTC, cioè ogni orario un'ora o due
 * indietro, senza una riga in console. Questi test verificano il contratto che
 * il core si aspetta — array di campi e scarto in minuti — perché è l'unico
 * modo di accorgersi in anticipo che quella conversione è tornata a mancare.
 */
import { describe, expect, it } from 'vitest';
import { Calendar } from '@fullcalendar/core';
import { createFormatter, DateEnv } from '@fullcalendar/core/internal';
import { fusoPlugin } from '../../src/lib/fuso-fullcalendar';
import { daLocaleAIstante, FUSO_APP } from '../../src/lib/time';

/** L'implementazione che il plugin consegna al core, per interrogarla diretta. */
const impl = new (
	fusoPlugin as unknown as {
		namedTimeZonedImpl: new (nome: string) => {
			timestampToArray(ms: number): number[];
			offsetForArray(a: number[]): number;
		};
	}
).namedTimeZonedImpl(FUSO_APP);

describe('il plugin è agganciato al core', () => {
	it('espone un’implementazione di fuso: senza, il calendario disegnerebbe in UTC', () => {
		expect(impl).toBeTruthy();
		expect(Calendar).toBeTypeOf('function');
	});
});

describe('da istante ai campi dell’orologio da parete', () => {
	it('legge l’ora legale come UTC+2', () => {
		// 20:00Z del 12 luglio sono le 22:00 a Roma.
		const ms = Date.UTC(2026, 6, 12, 20, 0);
		expect(impl.timestampToArray(ms)).toEqual([2026, 6, 12, 22, 0, 0, 0]);
	});

	it('legge l’ora solare come UTC+1', () => {
		const ms = Date.UTC(2026, 0, 12, 21, 0);
		expect(impl.timestampToArray(ms)).toEqual([2026, 0, 12, 22, 0, 0, 0]);
	});

	it('non perde secondi e millisecondi nel passaggio', () => {
		const ms = Date.UTC(2026, 6, 12, 20, 0, 37, 250);
		expect(impl.timestampToArray(ms)).toEqual([2026, 6, 12, 22, 0, 37, 250]);
	});

	it('porta al giorno giusto la mezzanotte italiana', () => {
		// 22:00Z del 12 luglio è già il 13 a Roma: è il caso in cui il
		// calendario, in UTC, disegnerebbe la data nella casella sbagliata.
		const ms = Date.UTC(2026, 6, 12, 22, 30);
		expect(impl.timestampToArray(ms)).toEqual([2026, 6, 13, 0, 30, 0, 0]);
	});
});

describe('dallo orario di parete allo scarto in minuti', () => {
	it('vale +120 in ora legale e +60 in ora solare', () => {
		expect(impl.offsetForArray([2026, 6, 12, 22, 0, 0, 0])).toBe(120);
		expect(impl.offsetForArray([2026, 0, 12, 22, 0, 0, 0])).toBe(60);
	});

	it('cambia nel giorno del passaggio, non a mezzanotte', () => {
		// Ultima domenica di marzo 2026: il 29, alle 02:00 locali.
		expect(impl.offsetForArray([2026, 2, 28, 23, 0, 0, 0])).toBe(60);
		expect(impl.offsetForArray([2026, 2, 29, 4, 0, 0, 0])).toBe(120);
	});
});

describe('andata e ritorno', () => {
	it('un orario inserito nel form torna identico a schermo', () => {
		for (const locale of [
			'2026-01-12T22:00',
			'2026-07-12T22:00',
			'2026-09-11T21:30',
			'2026-09-12T02:11',
			'2026-03-29T04:00',
			'2026-10-25T22:00'
		]) {
			const [data, ora] = locale.split('T');
			const [anno, mese, giorno] = data.split('-').map(Number);
			const [h, m] = ora.split(':').map(Number);
			const parete = impl.timestampToArray(daLocaleAIstante(locale).getTime());
			expect(parete).toEqual([anno, mese - 1, giorno, h, m, 0, 0]);
		}
	});
});

/**
 * La prova sul vero motore di date di FullCalendar.
 *
 * I test qui sopra verificano i due metodi del contratto; questo verifica che
 * agganciarli serva davvero, e lo fa dal `DateEnv` del core — cioè dallo stesso
 * codice che decide che cosa finisce a schermo. È l'unico test che fallirebbe
 * se un domani il core cambiasse il nome dell'opzione: gli altri passerebbero
 * tutti con un plugin che nessuno usa più.
 */
describe('il calendario disegna l’ora di parete italiana', () => {
	/**
	 * Il `DateEnv` vuole un oggetto locale interno, che il core costruisce da
	 * sé e non esporta: qui basta la parte che legge, e il cast dice proprio
	 * questo. Nessuna di queste opzioni influisce sul fuso.
	 */
	const locale = {
		codeArg: 'it',
		codes: ['it'],
		week: { dow: 1, doy: 4 },
		simpleNumberFormat: new Intl.NumberFormat('it'),
		options: { weekText: 'Sett', weekTextLong: 'Settimana', buttonText: {} }
	};

	const ambiente = (namedTimeZoneImpl: unknown) =>
		new DateEnv({
			timeZone: FUSO_APP,
			namedTimeZoneImpl,
			calendarSystem: 'gregory',
			locale,
			weekNumberCalculation: 'local',
			firstDay: 1,
			weekText: 'Sett',
			weekTextLong: 'Settimana',
			cmdFormatter: undefined,
			defaultSeparator: ' - '
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any);

	const formato = createFormatter({ hour: '2-digit', minute: '2-digit', hour12: false });

	/** Quel che `aEventoCalendario()` mette nel campo `start`, disegnato. */
	const aSchermo = (env: DateEnv, iso: string) => {
		const meta = env.createMarkerMeta(iso)!;
		return env.format(meta.marker, formato, { forcedTzo: meta.forcedTzo ?? undefined });
	};

	const inizio = daLocaleAIstante('2026-09-11T21:30').toISOString();

	it('mostra le 21:30 di un concerto salvato alle 21:30', () => {
		expect(aSchermo(ambiente(impl.constructor), inizio)).toBe('21:30');
	});

	it('senza l’implementazione di fuso mostrerebbe le 19:30: è il bug che si sta impedendo', () => {
		expect(aSchermo(ambiente(null), inizio)).toBe('19:30');
	});

	it('vale anche in ora solare, dove lo scarto è di un’ora sola', () => {
		const gennaio = daLocaleAIstante('2026-01-12T21:30').toISOString();
		expect(aSchermo(ambiente(impl.constructor), gennaio)).toBe('21:30');
		expect(aSchermo(ambiente(null), gennaio)).toBe('20:30');
	});
});
