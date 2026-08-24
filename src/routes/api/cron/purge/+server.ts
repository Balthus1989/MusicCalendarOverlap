import { json, type RequestHandler } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/client';
import { GIORNI_CONSERVAZIONE_NOTIFICHE, scadiNotifiche } from '$lib/server/notifications/service';
import { GIORNI_CONSERVAZIONE, scadiParseJobs } from '$lib/server/parse/retention';
import { scadiRateLimit } from '$lib/server/ratelimit';

/**
 * Pulizia notturna dei dati con una scadenza (ADR-0032).
 *
 * La prima è il registro degli incolla, dove `raw_text` è testo copiato da
 * altrove che può contenere dati personali di terzi. Vive novanta giorni, poi
 * se ne va.
 *
 * Dalla Fase 6 c'è anche la casella delle notifiche, con una scadenza più
 * lunga e per un motivo diverso: là dentro non c'è niente che il destinatario
 * non potesse già vedere, ma una casella che cresce all'infinito è comunque
 * una casella che nessuno apre.
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
	const db = getDb();
	const parse = await scadiParseJobs(db);
	const notifiche = await scadiNotifiche(db);
	// I contatori di rate limit non sono dati di nessuno: sono righe che
	// smettono di servire quando la loro finestra passa (ADR-0037).
	const rateLimit = await scadiRateLimit(db);

	return json(
		{
			parseJobs: { ...parse, giorniConservazione: GIORNI_CONSERVAZIONE },
			notifiche: { ...notifiche, giorniConservazione: GIORNI_CONSERVAZIONE_NOTIFICHE },
			rateLimit,
			durataMs: Date.now() - inizio
		},
		{ headers: { 'Cache-Control': 'private, no-store' } }
	);
};
