import { json, type RequestHandler } from '@sveltejs/kit';
import { ricalcolaFinestra } from '$lib/server/conflicts/reconcile';
import { getDb } from '$lib/server/db/client';
import { avvisiConflittiNuovi } from '$lib/server/notifications/conflitti';
import { notifica } from '$lib/server/notifications/service';
import type { Avviso } from '$lib/server/notifications/types';

/** Quanto avanti guardare, se non è specificato altro. */
const MESI_PREDEFINITI = 18;

/** Un giorno all'indietro: una data di ieri può ancora avere conflitti da chiudere. */
const GIORNI_INDIETRO = 1;

/**
 * Ricalcolo notturno di tutti i conflitti futuri (ARCHITECTURE.md §6.4 punto 4).
 *
 * Serve a recuperare le derive, non a fare il lavoro ordinario: quello lo fa
 * `riconciliaConflitti` a ogni salvataggio. Qui si rimedia ai casi in cui quel
 * ricalcolo è fallito in silenzio — è progettato per non sollevare mai — o in
 * cui qualcosa è cambiato sotto: un raggio predefinito modificato in `/org`,
 * una scheda artista unita da un moderatore, una riga corretta a mano.
 *
 * Idempotente per costruzione: riconciliare due volte di seguito produce lo
 * stesso stato. Si può rilanciare senza pensarci — e dalla Fase 6 vale anche
 * per le notifiche, che hanno una chiave di deduplica nel database.
 *
 * Il segreto lo verifica `cronGuard` in `hooks.server.ts`, che copre ogni
 * rotta sotto `/api/cron/`: qui non si ricontrolla, perché due verifiche
 * della stessa cosa prima o poi divergono.
 */
export const POST: RequestHandler = async ({ url }) => {
	const mesiRichiesti = Number(url.searchParams.get('mesi') ?? '');
	const mesi =
		Number.isFinite(mesiRichiesti) && mesiRichiesti > 0 && mesiRichiesti <= 60
			? Math.trunc(mesiRichiesti)
			: MESI_PREDEFINITI;

	const adesso = new Date();
	const da = new Date(adesso.getTime() - GIORNI_INDIETRO * 86_400_000);
	const a = new Date(adesso);
	a.setUTCMonth(a.getUTCMonth() + mesi);

	const inizio = Date.now();
	const db = getDb();

	/**
	 * Gli avvisi si accumulano e partono in fondo, non uno per evento.
	 *
	 * Su Cloudflare ogni `fetch` è una subrequest e il bilancio è finito: una
	 * corsa che ricalcola trecento date e spedisce man mano rischierebbe di
	 * esaurirlo proprio la notte in cui è successo qualcosa. In fondo, invece,
	 * è una richiesta sola a Resend per ogni centinaio di messaggi.
	 */
	const avvisi: Avviso[] = [];

	const esito = await ricalcolaFinestra(db, da, a, async (riconciliazione) => {
		avvisi.push(...(await avvisiConflittiNuovi(db, riconciliazione)));
	});

	const notifiche = await notifica(db, avvisi);

	return json(
		{
			...esito,
			notifiche,
			finestra: { da: da.toISOString(), a: a.toISOString() },
			durataMs: Date.now() - inizio
		},
		{ headers: { 'Cache-Control': 'private, no-store' } }
	);
};
