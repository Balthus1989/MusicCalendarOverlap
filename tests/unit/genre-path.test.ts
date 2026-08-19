import { describe, expect, it } from 'vitest';
import {
	buildPath,
	commonPrefixDepth,
	depthOf,
	isAncestorPath,
	resolveTree
} from '../../src/lib/server/genres/path';
import { GENRES } from '../../db/seeds/genres';

describe('buildPath / depthOf', () => {
	it('una radice è il proprio path, a profondità 0', () => {
		expect(buildPath('metal', null)).toBe('metal');
		expect(depthOf('metal')).toBe(0);
	});

	it('concatena con il separatore', () => {
		expect(buildPath('death-metal', 'metal')).toBe('metal.death-metal');
		expect(buildPath('tech-death', 'metal.death-metal')).toBe('metal.death-metal.tech-death');
		expect(depthOf('metal.death-metal.tech-death')).toBe(2);
	});
});

describe('isAncestorPath', () => {
	it('un path è antenato di sé stesso', () => {
		expect(isAncestorPath('metal', 'metal')).toBe(true);
	});

	it('riconosce la discendenza', () => {
		expect(isAncestorPath('metal', 'metal.death-metal')).toBe(true);
		expect(isAncestorPath('metal', 'metal.death-metal.tech-death')).toBe(true);
	});

	it('non confonde un prefisso di stringa con un antenato', () => {
		// Il caso che rompe `startsWith`: metalcore non sta sotto metal.
		expect(isAncestorPath('metal', 'metalcore')).toBe(false);
		expect(isAncestorPath('metal', 'metalcore.deathcore')).toBe(false);
	});

	it('non è simmetrico', () => {
		expect(isAncestorPath('metal.death-metal', 'metal')).toBe(false);
	});
});

describe('commonPrefixDepth', () => {
	it('conta i segmenti condivisi', () => {
		expect(commonPrefixDepth('metal.death-metal', 'metal.death-metal')).toBe(2);
		expect(commonPrefixDepth('metal.death-metal', 'metal.black-metal')).toBe(1);
		expect(commonPrefixDepth('metal.death-metal.tech-death', 'metal.death-metal')).toBe(2);
		expect(commonPrefixDepth('metal.death-metal', 'jazz.free-jazz')).toBe(0);
	});

	it('confronta per segmenti, non per caratteri', () => {
		expect(commonPrefixDepth('metal', 'metalcore')).toBe(0);
	});
});

describe('resolveTree', () => {
	it('risolve path e profondità di un alberello', () => {
		const risolti = resolveTree([
			{ slug: 'metal', parentSlug: null },
			{ slug: 'death-metal', parentSlug: 'metal' },
			{ slug: 'tech-death', parentSlug: 'death-metal' }
		]);

		expect(risolti.get('metal')).toEqual({ path: 'metal', depth: 0 });
		expect(risolti.get('death-metal')).toEqual({ path: 'metal.death-metal', depth: 1 });
		expect(risolti.get('tech-death')).toEqual({
			path: 'metal.death-metal.tech-death',
			depth: 2
		});
	});

	it('non dipende dall’ordine di dichiarazione', () => {
		const risolti = resolveTree([
			{ slug: 'tech-death', parentSlug: 'death-metal' },
			{ slug: 'metal', parentSlug: null },
			{ slug: 'death-metal', parentSlug: 'metal' }
		]);
		expect(risolti.get('tech-death')?.path).toBe('metal.death-metal.tech-death');
	});

	it('solleva su genitore inesistente', () => {
		expect(() => resolveTree([{ slug: 'orfano', parentSlug: 'inesistente' }])).toThrow(
			/non trovato/
		);
	});

	it('solleva sui cicli invece di ricorrere all’infinito', () => {
		expect(() =>
			resolveTree([
				{ slug: 'a', parentSlug: 'b' },
				{ slug: 'b', parentSlug: 'a' }
			])
		).toThrow(/Ciclo/);
	});
});

describe('seed della tassonomia', () => {
	const risolti = resolveTree(GENRES.map((g) => ({ slug: g.slug, parentSlug: g.parentSlug })));

	it('non ha slug duplicati', () => {
		const slugs = GENRES.map((g) => g.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
	});

	it('risolve ogni nodo', () => {
		expect(risolti.size).toBe(GENRES.length);
	});

	it('copre i generi richiesti da ARCHITECTURE.md §4.2', () => {
		const slugs = new Set(GENRES.map((g) => g.slug));
		for (const atteso of [
			'metal',
			'death-metal',
			'black-metal',
			'doom',
			'sludge',
			'thrash',
			'grindcore',
			'metalcore',
			'post-metal',
			'stoner',
			'tech-death',
			'djent',
			'punk-hardcore',
			'rock',
			'prog',
			'psych',
			'garage',
			'alternative',
			'indie',
			'elettronica',
			'techno',
			'ambient',
			'industrial',
			'drum-n-bass',
			'jazz',
			'cantautorale',
			'hip-hop',
			'reggae-dub',
			'folk-world',
			'sperimentale-noise',
			'classica'
		]) {
			expect(slugs, `manca il genere "${atteso}"`).toContain(atteso);
		}
	});

	it('colloca Tech Death sotto Death Metal, come richiede il caso numerico §6.3', () => {
		expect(risolti.get('tech-death')?.path).toBe('metal.death-metal.tech-death');
		expect(risolti.get('death-metal')?.path).toBe('metal.death-metal');
		// Il prefisso comune profondo 2 è ciò che in Fase 3 darà affinità 0.8.
		expect(
			commonPrefixDepth(risolti.get('tech-death')!.path, risolti.get('death-metal')!.path)
		).toBe(2);
	});

	it('tiene Death e Black sotto la stessa radice, a prefisso comune 1', () => {
		expect(
			commonPrefixDepth(risolti.get('death-metal')!.path, risolti.get('black-metal')!.path)
		).toBe(1);
	});

	it('non dà nessun prefisso comune fra Death Metal e Jazz', () => {
		expect(commonPrefixDepth(risolti.get('death-metal')!.path, risolti.get('jazz')!.path)).toBe(0);
	});

	it('non annida più di due livelli sotto la radice', () => {
		for (const [slug, { depth }] of risolti) {
			expect(depth, `"${slug}" è troppo profondo`).toBeLessThanOrEqual(2);
		}
	});
});
