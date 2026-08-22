/**
 * Connessione al database (ARCHITECTURE.md §3).
 *
 * A runtime si passa **sempre** dal pooler Supavisor (porta 6543, transaction
 * mode, `prepare: false`): è obbligatorio in ambiente serverless. Le migrazioni
 * usano invece `DIRECT_DATABASE_URL` (porta 5432) e girano da locale o da CI,
 * mai a runtime — vedi `drizzle.config.ts`.
 */
import { env } from '$env/dynamic/private';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

let cached: Database | null = null;

export function getDb(): Database {
	if (cached) return cached;

	const url = env.DATABASE_URL;
	if (!url) {
		throw new Error(
			'DATABASE_URL non configurata. Copia .env.example in .env e valorizzala con la stringa del pooler Supavisor (porta 6543).'
		);
	}

	const sql = postgres(url, {
		// Transaction mode del pooler: le prepared statement non sopravvivono
		// alla transazione, vanno disattivate.
		prepare: false,
		// Una connessione per isolate: il pooler fa il resto.
		max: 1,
		idle_timeout: 20,
		connect_timeout: 10
	});

	cached = drizzle(sql, { schema });
	return cached;
}

export { schema };
