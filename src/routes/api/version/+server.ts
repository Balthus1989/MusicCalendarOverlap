import { json, type RequestHandler } from '@sveltejs/kit';

/**
 * Che cosa sta girando, in una riga di JSON.
 *
 * **Pubblico e senza sessione**, a differenza di ogni altro endpoint di
 * `/api`: serve a controllare che un deploy sia andato dove doveva senza
 * aprire l'applicazione e senza avere un account, ed espone un numero di
 * rilascio e un commit — niente che la matrice di §5 governi.
 *
 * `no-store` non è prudenza generica: è l'unica risposta del prodotto la cui
 * utilità sta tutta nell'essere aggiornata. Una copia in cache direbbe la
 * versione di ieri proprio a chi sta verificando quella di adesso.
 */
export const GET: RequestHandler = () =>
	json({ versione: __VERSIONE__ }, { headers: { 'Cache-Control': 'no-store' } });
