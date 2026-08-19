import { describe, expect, it } from 'vitest';
import {
	levenshtein,
	looksLikeDuplicate,
	normalizeGeocodeQuery,
	normalizeName,
	slugify
} from '../../src/lib/server/text';

describe('normalizeName', () => {
	it('abbassa e collassa gli spazi', () => {
		expect(normalizeName('Nero  Sabbia')).toBe('nero sabbia');
		expect(normalizeName('  Fossa  ')).toBe('fossa');
	});

	it('toglie gli accenti', () => {
		expect(normalizeName('Càrcere')).toBe('carcere');
		expect(normalizeName('Motörhead')).toBe('motorhead');
		expect(normalizeName('Sigur Rós')).toBe('sigur ros');
	});

	it('espande la ß, che NFD non decompone', () => {
		expect(normalizeName('Straße')).toBe('strasse');
	});

	it('fa collassare gli apostrofi invece di spezzare la parola', () => {
		expect(normalizeName("Drum'n'Bass")).toBe('drumnbass');
		expect(normalizeName('Drum’n’Bass')).toBe('drumnbass');
	});

	it('tratta la punteggiatura come separatore', () => {
		expect(normalizeName('Godspeed You! Black Emperor')).toBe('godspeed you black emperor');
		expect(normalizeName('!!!')).toBe('');
	});

	it('conserva le cifre', () => {
		expect(normalizeName('Blink-182')).toBe('blink 182');
	});

	it('è idempotente', () => {
		const once = normalizeName('Càrcere / Nero Sabbia');
		expect(normalizeName(once)).toBe(once);
	});
});

describe('slugify', () => {
	it('produce slug URL-safe', () => {
		expect(slugify('Associazione Rumore Bianco')).toBe('associazione-rumore-bianco');
		expect(slugify('Circolo Arci "Sabotage"')).toBe('circolo-arci-sabotage');
		expect(slugify('Città di Castello')).toBe('citta-di-castello');
	});
});

describe('normalizeGeocodeQuery', () => {
	it('fa collidere query equivalenti', () => {
		expect(normalizeGeocodeQuery('Via Roma 12, Perugia')).toBe(
			normalizeGeocodeQuery('via roma 12 perugia')
		);
	});

	it('ignora il tipo di odonimo', () => {
		const a = normalizeGeocodeQuery('Piazza Garibaldi, Terni');
		const b = normalizeGeocodeQuery('Garibaldi, Terni');
		expect(a).toBe(b);
	});
});

describe('levenshtein', () => {
	it('vale zero su stringhe identiche', () => {
		expect(levenshtein('fossa', 'fossa')).toBe(0);
	});

	it('conta le singole modifiche', () => {
		expect(levenshtein('fossa', 'fosse')).toBe(1);
		expect(levenshtein('fossa', 'fossai')).toBe(1);
		expect(levenshtein('fossa', 'fosa')).toBe(1);
	});

	it('gestisce la stringa vuota', () => {
		expect(levenshtein('', 'fossa')).toBe(5);
		expect(levenshtein('fossa', '')).toBe(5);
	});

	it('è simmetrica', () => {
		expect(levenshtein('malanotte', 'malanote')).toBe(levenshtein('malanote', 'malanotte'));
	});
});

describe('looksLikeDuplicate', () => {
	it('riconosce le differenze di sola forma', () => {
		expect(looksLikeDuplicate('Nero Sabbia', 'nero  sabbia')).toBe(true);
		expect(looksLikeDuplicate('Càrcere', 'Carcere')).toBe(true);
	});

	it('riconosce un refuso su un nome lungo', () => {
		expect(looksLikeDuplicate('Vuoto Pneumatico', 'Vuoto Pnuematico')).toBe(true);
	});

	it('non confonde band diverse', () => {
		expect(looksLikeDuplicate('Fossa', 'Fauci')).toBe(false);
		expect(looksLikeDuplicate('Le Ossa', 'Malanotte')).toBe(false);
	});

	it('non avvisa sui nomi cortissimi, dove ogni refuso sfonda la soglia', () => {
		// Due lettere di differenza su quattro sarebbero il 50%: senza questa
		// guardia qualunque nome corto risulterebbe doppione di qualunque altro.
		expect(looksLikeDuplicate('Muse', 'Fuse')).toBe(false);
	});

	it('ignora le stringhe vuote', () => {
		expect(looksLikeDuplicate('', 'Fossa')).toBe(false);
		expect(looksLikeDuplicate('!!!', '???')).toBe(false);
	});
});
