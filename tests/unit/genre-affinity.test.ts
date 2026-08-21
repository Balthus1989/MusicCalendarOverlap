/**
 * Affinità di genere (ARCHITECTURE.md §6.3 e §15).
 *
 * I tre casi numerici attesi sono scritti nel documento di architettura come
 * esempi da usare come test: Tech Death contro Death Metal → 0.8, Death Metal
 * contro Black Metal → 0.5, Death Metal contro Jazz → 0.0. Se uno di questi
 * cambia, è cambiata la definizione di "stesso pubblico", e va discusso in un
 * ADR — non aggiustato qui.
 */
import { describe, expect, it } from 'vitest';
import {
	affinitaFraEventi,
	affinitaFraGeneri,
	PESO_SECONDARIO,
	SOGLIA_AFFINITA,
	SOGLIA_AFFINITA_ALTA
} from '../../src/lib/server/conflicts/genre-affinity';

const METAL = 'metal';
const DEATH = 'metal.death-metal';
const BLACK = 'metal.black-metal';
const TECH_DEATH = 'metal.death-metal.tech-death';
const METALCORE = 'metalcore';
const JAZZ = 'jazz';

describe('affinità fra due generi — i casi attesi di §6.3', () => {
	it('Tech Death contro Death Metal vale 0.8', () => {
		expect(affinitaFraGeneri(TECH_DEATH, DEATH)).toBe(0.8);
	});

	it('Death Metal contro Black Metal vale 0.5', () => {
		expect(affinitaFraGeneri(DEATH, BLACK)).toBe(0.5);
	});

	it('Death Metal contro Jazz vale 0', () => {
		expect(affinitaFraGeneri(DEATH, JAZZ)).toBe(0);
	});
});

describe('affinità fra due generi — il resto della definizione', () => {
	it('lo stesso genere vale 1', () => {
		expect(affinitaFraGeneri(DEATH, DEATH)).toBe(1);
	});

	it('è simmetrica', () => {
		expect(affinitaFraGeneri(TECH_DEATH, METAL)).toBe(affinitaFraGeneri(METAL, TECH_DEATH));
		expect(affinitaFraGeneri(DEATH, BLACK)).toBe(affinitaFraGeneri(BLACK, DEATH));
	});

	it('due livelli di scarto valgono meno di uno solo', () => {
		// `0.9 - 0.1 × scarto`: la radice contro un nipote è più lontana della
		// radice contro un figlio.
		expect(affinitaFraGeneri(METAL, DEATH)).toBe(0.8);
		expect(affinitaFraGeneri(METAL, TECH_DEATH)).toBe(0.7);
	});

	it('due cugini a profondità diverse contano i segmenti in comune', () => {
		// `metal` in comune, profondità massima 2: 1 / (2 + 1).
		expect(affinitaFraGeneri(TECH_DEATH, BLACK)).toBeCloseTo(0.33, 2);
	});

	it('metalcore non è un sottogenere di metal, per quanto il nome lo somigli', () => {
		// È il caso per cui `isAncestorPath` confronta i segmenti e non usa
		// `startsWith`: qui una svista renderebbe affini due generi che non lo
		// sono, e la regola R3 scatterebbe a sproposito.
		expect(affinitaFraGeneri(METAL, METALCORE)).toBe(0);
	});

	it('un genere fratello resta sopra la soglia di R3, uno estraneo sotto', () => {
		// È la coppia di asserzioni che dà senso alla soglia: due sottogeneri
		// del metal si contendono il pubblico, il metal e il jazz no.
		expect(affinitaFraGeneri(DEATH, BLACK)).toBeGreaterThanOrEqual(SOGLIA_AFFINITA);
		expect(affinitaFraGeneri(DEATH, JAZZ)).toBeLessThan(SOGLIA_AFFINITA);
	});
});

const primario = (path: string) => ({ path, isPrimary: true });
const secondario = (path: string) => ({ path, isPrimary: false });

describe('affinità fra due eventi', () => {
	it('prende il massimo sulle coppie, non la media', () => {
		// La serata A ha un genere che coincide con quello di B più altri due
		// che non c'entrano niente: la media li premierebbe per aver descritto
		// bene il cartellone, mentre la domanda è se esiste *almeno un* motivo
		// per cui lo stesso pubblico debba scegliere.
		const a = [primario(DEATH), secondario(JAZZ), secondario('classica')];
		const b = [primario(DEATH)];
		expect(affinitaFraEventi(a, b).valore).toBe(1);
	});

	it('un genere secondario pesa meno di uno primario', () => {
		const conPrimario = affinitaFraEventi([primario(DEATH)], [primario(DEATH)]).valore;
		const conSecondario = affinitaFraEventi([secondario(DEATH)], [primario(DEATH)]).valore;

		expect(conPrimario).toBe(1);
		expect(conSecondario).toBe(PESO_SECONDARIO);
		expect(conSecondario).toBeLessThan(conPrimario);
	});

	it('i pesi si moltiplicano: secondario contro secondario pesa ancora meno', () => {
		expect(affinitaFraEventi([secondario(DEATH)], [secondario(DEATH)]).valore).toBeCloseTo(
			PESO_SECONDARIO * PESO_SECONDARIO,
			2
		);
	});

	it('dice quale coppia di generi ha prodotto il massimo', () => {
		// Serve a spiegare l'avviso: senza, il messaggio potrebbe solo dire
		// "generi affini" senza saper indicare quali.
		const esito = affinitaFraEventi([primario(JAZZ), secondario(DEATH)], [primario(TECH_DEATH)]);
		expect(esito.coppia).toEqual({ pathA: DEATH, pathB: TECH_DEATH });
	});

	it('un evento senza generi ha affinità zero con chiunque', () => {
		// Non è un caso limite da evitare: finirà in R4, "c'è un'altra serata
		// in zona", che è tutto ciò che si può onestamente dire di una serata
		// di cui non si sa niente.
		const esito = affinitaFraEventi([], [primario(DEATH)]);
		expect(esito.valore).toBe(0);
		expect(esito.coppia).toBeNull();
	});

	it('due generi identici e primari superano la soglia alta', () => {
		expect(affinitaFraEventi([primario(DEATH)], [primario(DEATH)]).valore).toBeGreaterThanOrEqual(
			SOGLIA_AFFINITA_ALTA
		);
	});

	it('un secondario affine a un primario resta sotto la soglia alta ma sopra quella bassa', () => {
		// 0.8 × 0.7 = 0.56: abbastanza per essere R3, non abbastanza per `high`.
		const v = affinitaFraEventi([secondario(TECH_DEATH)], [primario(DEATH)]).valore;
		expect(v).toBeGreaterThanOrEqual(SOGLIA_AFFINITA);
		expect(v).toBeLessThan(SOGLIA_AFFINITA_ALTA);
	});
});
