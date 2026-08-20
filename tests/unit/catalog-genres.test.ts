import { describe, expect, it } from 'vitest';
import { inArray, sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { genres } from '../../src/lib/server/db/schema';

/**
 * Regressione su `setArtistGenres`.
 *
 * La versione originale selezionava i generi con
 * `sql`${genres.slug} = any(${slugs})``. Drizzle interpola un array JS come
 * **tupla** `($1, $2)`, non come array Postgres: la clausola risultante era
 * SQL non valido e ogni assegnazione di generi falliva. L'artista finiva in
 * anagrafica senza generi e la richiesta terminava con un errore interno.
 *
 * Non e' un difetto cosmetico: i generi sono cio' su cui il motore conflitti
 * calcola l'affinita' (ARCHITECTURE.md §6.3). Una band senza generi non entra
 * nella regola R3.
 */
const dialect = new PgDialect();
const rendi = (frammento: ReturnType<typeof inArray>) => dialect.sqlToQuery(frammento.getSQL());

describe('selezione dei generi per slug', () => {
	const slugs = ['sludge', 'stoner'];

	it('inArray produce una clausola IN con un segnaposto per valore', () => {
		const q = rendi(inArray(genres.slug, slugs));
		expect(q.sql).toMatch(/in \(\$1,\s*\$2\)/i);
		expect(q.params).toEqual(slugs);
	});

	it('interpolare un array in `any()` produce una tupla, non un array', () => {
		// Documenta la forma sbagliata, cosi' il confronto resta visibile a chi
		// legge e nessuno la reintroduce pensando che sia equivalente.
		const q = dialect.sqlToQuery(sql`${genres.slug} = any(${slugs})`.getSQL());
		expect(q.sql).toContain('any((');
		expect(q.sql).not.toMatch(/any\(\$\d+\)/);
	});

	it('funziona con un solo slug', () => {
		const q = rendi(inArray(genres.slug, ['sludge']));
		expect(q.sql).toMatch(/in \(\$1\)/i);
		expect(q.params).toEqual(['sludge']);
	});
});
