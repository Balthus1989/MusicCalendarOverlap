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

/**
 * La cache vive su `globalThis`, non in una variabile di modulo.
 *
 * In sviluppo Vite valuta il grafo dei moduli SSR **più di una volta**: a ogni
 * ri-ottimizzazione delle dipendenze o ricarica di `hooks.server.ts` questo
 * file viene rieseguito da capo. Con una `let` di modulo ogni copia si porta
 * dietro la propria cache vuota e apre un client nuovo, mentre i precedenti
 * restano vivi con la loro connessione — e siccome `max: 1` significa una
 * connessione per client, si finisce con più connessioni in giro di quante il
 * codice creda di averne, alcune appartenenti a moduli ormai scartati. Da lì
 * le richieste che restano appese senza errore, che il runbook descrive alla
 * voce «Ogni pagina che tocca il database resta appesa».
 *
 * `globalThis` sopravvive alla rivalutazione del modulo, quindi tutte le
 * copie condividono un client solo. In produzione il grafo si valuta una
 * volta e questo non cambia niente: è una rete di sicurezza per lo sviluppo,
 * al costo di una proprietà con un nome esplicito.
 */
const CHIAVE = Symbol.for('calendario.db');

type Contenitore = typeof globalThis & { [CHIAVE]?: Database };

export function getDb(): Database {
	const contenitore = globalThis as Contenitore;
	const gia = contenitore[CHIAVE];
	if (gia) return gia;

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

	const db = drizzle(sql, { schema });
	contenitore[CHIAVE] = db;
	return db;
}

export { schema };
