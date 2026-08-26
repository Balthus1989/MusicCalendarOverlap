/**
 * Connessione al database (ARCHITECTURE.md §3, ADR-0026, ADR-0041).
 *
 * A runtime si passa **sempre** dal pooler Supavisor (porta 6543, transaction
 * mode, `prepare: false`): è obbligatorio in ambiente serverless. Le migrazioni
 * usano invece `DIRECT_DATABASE_URL` (porta 5432) e girano da locale o da CI,
 * mai a runtime — vedi `drizzle.config.ts`.
 *
 * **La connessione vive quanto la richiesta, e non un istante di più.**
 *
 * Questo file teneva il pool in una variabile di modulo, riusandolo per tutte
 * le richieste. Su Node è la cosa giusta. Su Cloudflare Workers è un guasto: un
 * socket aperto nel contesto di una richiesta **non può essere usato da
 * un'altra**, e il tentativo fallisce all'istante. Il sintomo in produzione era
 * un 500 sì e uno no, sempre sulla prima query della richiesta, sempre in
 * pochi millisecondi — troppo pochi perché ci fosse stata una rete di mezzo
 * (ADR-0041).
 *
 * Il perimetro della richiesta lo tiene `AsyncLocalStorage`, e non un parametro
 * passato di mano in mano: `getDb()` è chiamata da una trentina di file, e
 * cambiarne la firma avrebbe voluto dire toccarli tutti per un dettaglio di cui
 * nessuno di loro deve sapere niente.
 */
import { env } from '$env/dynamic/private';
import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * Il perimetro di una richiesta. Nasce **vuoto**: la connessione si apre solo
 * se qualcuno chiede `getDb()`.
 *
 * La pigrizia non è un'ottimizzazione, è ciò che tiene il build indipendente
 * dal database. Aprendo subito, la prerenderizzazione di `/offline` — che una
 * riga di SQL non la esegue — pretendeva `DATABASE_URL`, e la CI, che quella
 * variabile non ce l'ha e non deve averla, è diventata rossa.
 */
type Perimetro = { db: Database | null; chiudi: (() => Promise<void>) | null };

const perRichiesta = new AsyncLocalStorage<Perimetro>();

function creaConnessione(): { db: Database; chiudi: () => Promise<void> } {
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
		 * `load` del layout e quella della pagina.
		 *
		 * **Cinque e non dieci**, da quando il pool dura una richiesta sola: il
		 * numero non deve più coprire tutte le richieste insieme, ma solo le
		 * query concorrenti di una — che sono due o tre. Dieci per richiesta
		 * moltiplicherebbero le connessioni verso il pooler senza che nessuno
		 * le usi. Vedi ADR-0026 e ADR-0041.
		 */
		max: 5,
		idle_timeout: 20,
		connect_timeout: 10
	});

	return {
		db: drizzle(sql, { schema }),
		chiudi: () => sql.end({ timeout: 5 }).catch(() => {})
	};
}

/**
 * Delimita la richiesta, e chiude ciò che è stato aperto dentro.
 *
 * La chiama `hooks.server.ts` una volta per richiesta, avvolgendo tutto il
 * resto della catena. **Non apre niente da sé**: una richiesta che il database
 * non lo tocca — un asset, la pagina di login, la prerenderizzazione di
 * `/offline` — non paga niente e non pretende nemmeno che `DATABASE_URL` esista.
 */
export async function conDatabase<T>(fn: () => Promise<T>): Promise<T> {
	const perimetro: Perimetro = { db: null, chiudi: null };
	try {
		return await perRichiesta.run(perimetro, fn);
	} finally {
		// `finally` e non dopo il `return`: una richiesta che fallisce deve
		// chiudere quello che ha aperto, altrimenti il pooler si riempie di
		// connessioni che nessuno rivendicherà.
		await perimetro.chiudi?.();
	}
}

/**
 * Il database della richiesta in corso.
 *
 * Fuori da una richiesta — uno script di seed, un test — non c'è nessun
 * perimetro e si costruisce un client usa-e-getta. Non viene chiuso da
 * nessuno, ed è accettabile solo perché quei processi finiscono: **dentro
 * l'applicazione questo ramo non deve essere raggiunto**, e se lo fosse
 * significherebbe che qualcosa gira fuori da `conDatabase`.
 */
export function getDb(): Database {
	const perimetro = perRichiesta.getStore();
	if (!perimetro) return creaConnessione().db;

	if (perimetro.db) return perimetro.db;

	const connessione = creaConnessione();
	perimetro.db = connessione.db;
	perimetro.chiudi = connessione.chiudi;
	return connessione.db;
}

export { schema };
