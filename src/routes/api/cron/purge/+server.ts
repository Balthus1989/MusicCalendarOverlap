import { json, type RequestHandler } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/client';
import { GIORNI_CONSERVAZIONE, scadiParseJobs } from '$lib/server/parse/retention';

/**
 * Pulizia notturna dei dati con una scadenza (ADR-0032).
 *
 * Per ora ne ha una sola: il registro degli incolla, dove `raw_text` è testo
 * copiato da altrove che può contenere dati personali di terzi. Vive novanta
 * giorni, poi se ne va.
 *
 * È un endpoint a parte e non un pezzo di `/api/cron/recompute` perché fa una
 * cosa diversa — quello ricalcola, questo cancella — e perché un ricalcolo che
 * cancella righe è la sorpresa che nessuno vuole trovare leggendo il codice a
 * distanza di mesi. Lo chiama la stessa GitHub Action notturna: un secondo
 * `curl`, nessuno scheduler in più (ADR-0013).
 *
 * Il segreto lo verifica `cronGuard` in `hooks.server.ts`, che copre ogni
 * rotta sotto `/api/cron/`.
 */
export const POST: RequestHandler = async () => {
	const inizio = Date.now();
	const parse = await scadiParseJobs(getDb());

	return json(
		{
			parseJobs: { ...parse, giorniConservazione: GIORNI_CONSERVAZIONE },
			durataMs: Date.now() - inizio
		},
		{ headers: { 'Cache-Control': 'private, no-store' } }
	);
};
