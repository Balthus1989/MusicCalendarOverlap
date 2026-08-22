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
		/**
		 * **Più di una connessione, e non è un'ottimizzazione: è correttezza.**
		 *
		 * Con `max: 1` postgres.js accoda in *pipeline* le query concorrenti
		 * sulla stessa connessione. È lecito verso un Postgres diretto, non
		 * verso Supavisor in transaction mode, che assegna una connessione di
		 * servizio per transazione: il dialogo si desincronizza, la sessione
		 * resta `active` su `wait_event = ClientRead` — Postgres ha finito e
		 * aspetta un client che non parlerà più — e dopo il `statement_timeout`
		 * di due minuti muore una query a caso fra quelle in coda.
		 *
		 * La concorrenza non è un caso raro: SvelteKit esegue in parallelo la
		 * `load` del layout e quella della pagina, e un browser apre più
		 * richieste insieme. Misurato: una richiesta sola a `/calendar`
		 * rispondeva 200 in 870 ms, tre in parallelo restavano appese tutte e
		 * tre. Con dieci connessioni, cinque richieste insieme tornano 200 in
		 * circa 1,4 secondi.
		 *
		 * Dieci e non una: bastano a coprire le `load` in parallelo con
		 * margine, e moltiplicare le connessioni client è esattamente il
		 * lavoro per cui esiste un pooler. Vedi ADR-0026.
		 */
		max: 10,
		idle_timeout: 20,
		connect_timeout: 10
	});

	cached = drizzle(sql, { schema });
	return cached;
}

export { schema };
