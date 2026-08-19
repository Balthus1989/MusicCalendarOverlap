/**
 * Applica i seed versionati. Idempotente: si può rilanciare a ogni deploy.
 *
 *   npm run db:seed
 *
 * Usa la connessione diretta (`DIRECT_DATABASE_URL`), come le migrazioni:
 * è un'operazione da locale o da CI, mai a runtime.
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { inArray, sql as dsql } from 'drizzle-orm';
import { genres } from '../../src/lib/server/db/schema.ts';
import { resolveTree } from '../../src/lib/server/genres/path.ts';
import { GENRES } from './genres.ts';

const url = process.env.DIRECT_DATABASE_URL;
if (!url) {
	console.error(
		'DIRECT_DATABASE_URL non configurata. I seed girano sulla connessione diretta (porta 5432).'
	);
	process.exit(1);
}

const sql = postgres(url, { max: 1 });
const db = drizzle(sql);

async function seedGenres() {
	const paths = resolveTree(GENRES.map((g) => ({ slug: g.slug, parentSlug: g.parentSlug })));

	// Prima passata: le righe, senza `parent_id`. Non possiamo risolvere gli
	// id dei genitori prima di averli inseriti, e l'ordine di `GENRES` non
	// garantisce che un genitore preceda i figli.
	const righe = GENRES.map((g) => {
		const risolto = paths.get(g.slug);
		if (!risolto) throw new Error(`Path non risolto per "${g.slug}"`);
		return {
			slug: g.slug,
			name: g.name,
			path: risolto.path,
			depth: risolto.depth,
			sortOrder: g.sortOrder
		};
	});

	await db
		.insert(genres)
		.values(righe)
		.onConflictDoUpdate({
			target: genres.slug,
			set: {
				name: dsql`excluded.name`,
				path: dsql`excluded.path`,
				depth: dsql`excluded.depth`,
				sortOrder: dsql`excluded.sort_order`
			}
		});

	// Seconda passata: i `parent_id`, ora che ogni slug ha un id.
	const salvati = await db
		.select({ id: genres.id, slug: genres.slug })
		.from(genres)
		.where(
			inArray(
				genres.slug,
				GENRES.map((g) => g.slug)
			)
		);
	const idBySlug = new Map(salvati.map((r) => [r.slug, r.id]));

	for (const g of GENRES) {
		const parentId = g.parentSlug ? (idBySlug.get(g.parentSlug) ?? null) : null;
		await sql`update genres set parent_id = ${parentId} where slug = ${g.slug}`;
	}

	return righe.length;
}

try {
	const n = await seedGenres();
	console.log(`Generi allineati: ${n}`);
} catch (err) {
	console.error('Seed fallito:', err);
	process.exitCode = 1;
} finally {
	await sql.end();
}
