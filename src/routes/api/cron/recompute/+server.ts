import { json, type RequestHandler } from '@sveltejs/kit';
import { ricalcolaFinestra } from '$lib/server/conflicts/reconcile';
import { getDb } from '$lib/server/db/client';

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
 * stesso stato. Si può rilanciare senza pensarci.
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
	const esito = await ricalcolaFinestra(getDb(), da, a);

	return json(
		{
			...esito,
			finestra: { da: da.toISOString(), a: a.toISOString() },
			durataMs: Date.now() - inizio
		},
		{ headers: { 'Cache-Control': 'private, no-store' } }
	);
};
