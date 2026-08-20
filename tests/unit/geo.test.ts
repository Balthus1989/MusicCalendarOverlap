/**
 * Distanze note, prese da coordinate reali (ARCHITECTURE.md §15).
 *
 * La tolleranza è di qualche chilometro: si sta misurando la distanza fra due
 * città, non fra due portoni, e il raggio di conflitto è comunque un numero
 * scelto a occhio dagli organizzatori.
 */
import { describe, expect, it } from 'vitest';
import {
	boundingBox,
	distanzaKm,
	entroRaggio,
	haCoordinate
} from '../../src/lib/server/conflicts/geo';

const PERUGIA = { lat: 43.1107, lon: 12.3908 };
const TERNI = { lat: 42.5636, lon: 12.6427 };
const ROMA = { lat: 41.9028, lon: 12.4964 };
const MILANO = { lat: 45.4642, lon: 9.19 };
const BOLZANO = { lat: 46.4983, lon: 11.3548 };

describe('distanza', () => {
	it('fra Perugia e Terni sono una sessantina di chilometri', () => {
		expect(distanzaKm(PERUGIA, TERNI)).toBeGreaterThan(60);
		expect(distanzaKm(PERUGIA, TERNI)).toBeLessThan(68);
	});

	it('fra Perugia e Roma sono circa 135 km', () => {
		expect(distanzaKm(PERUGIA, ROMA)).toBeGreaterThan(130);
		expect(distanzaKm(PERUGIA, ROMA)).toBeLessThan(140);
	});

	it('fra Roma e Milano sono circa 480 km', () => {
		expect(distanzaKm(ROMA, MILANO)).toBeGreaterThan(470);
		expect(distanzaKm(ROMA, MILANO)).toBeLessThan(490);
	});

	it('è zero fra un punto e se stesso', () => {
		expect(distanzaKm(PERUGIA, PERUGIA)).toBe(0);
	});

	it('è simmetrica', () => {
		expect(distanzaKm(PERUGIA, ROMA)).toBeCloseTo(distanzaKm(ROMA, PERUGIA), 9);
	});
});

describe('bounding box', () => {
	it('contiene il cerchio che deve contenere', () => {
		// Terni dista una sessantina di km: il rettangolo va misurato su un
		// raggio che la contiene davvero, altrimenti si testa altro.
		const raggio = 70;
		const box = boundingBox(PERUGIA, raggio);
		// Se il rettangolo la escludesse, il prefiltro SQL perderebbe un
		// conflitto vero prima ancora di calcolare l’haversine.
		expect(distanzaKm(PERUGIA, TERNI)).toBeLessThan(raggio);
		expect(TERNI.lat).toBeGreaterThan(box.latMin);
		expect(TERNI.lat).toBeLessThan(box.latMax);
		expect(TERNI.lon).toBeGreaterThan(box.lonMin);
		expect(TERNI.lon).toBeLessThan(box.lonMax);
	});

	it('si allarga in longitudine man mano che si sale di latitudine', () => {
		const sud = boundingBox(ROMA, 60);
		const nord = boundingBox(BOLZANO, 60);
		const larghezza = (b: ReturnType<typeof boundingBox>) => b.lonMax - b.lonMin;
		expect(larghezza(nord)).toBeGreaterThan(larghezza(sud));
	});

	it('non esce dai limiti della longitudine', () => {
		const box = boundingBox({ lat: 0, lon: 179.9 }, 500);
		expect(box.lonMax).toBeLessThanOrEqual(180);
		expect(box.lonMin).toBeGreaterThanOrEqual(-180);
	});
});

describe('entro raggio', () => {
	it('Terni rientra nei 60 km da Perugia solo di misura', () => {
		expect(entroRaggio(PERUGIA, TERNI, 70)).toBe(true);
		expect(entroRaggio(PERUGIA, TERNI, 50)).toBe(false);
	});

	it('Milano non rientra mai in un raggio da concerto', () => {
		expect(entroRaggio(ROMA, MILANO, 200)).toBe(false);
	});
});

describe('coordinate mancanti', () => {
	it('un evento senza coordinate resta fuori dai calcoli invece di finire a (0,0)', () => {
		expect(haCoordinate({ lat: null, lon: null })).toBe(false);
		expect(haCoordinate({ lat: 43.1, lon: null })).toBe(false);
		expect(haCoordinate({ lat: 0, lon: 0 })).toBe(true);
	});
});
