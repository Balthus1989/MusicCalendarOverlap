import { json, type RequestHandler } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/client';
import { avvisiDigest, etichettaSettimana } from '$lib/server/notifications/digest';
import { notifica } from '$lib/server/notifications/service';

/**
 * Il riepilogo settimanale (ARCHITECTURE.md §10, riga 4).
 *
 * Lo chiama una GitHub Action il lunedì mattina. È l'unico job a cadenza
 * settimanale: sta quindi in un endpoint suo e non insieme alla manutenzione
 * notturna, per la stessa ragione per cui `purge` è separato da `recompute` —
 * cose che succedono con ritmi diversi, in posti diversi.
 *
 * **Rilanciarlo è innocuo.** La chiave di deduplica contiene l'etichetta ISO
 * della settimana, quindi una seconda esecuzione dello stesso lunedì non
 * manda niente a nessuno: la risposta lo dice, con `ripetuti` maggiore di zero
 * e `registrate` a zero.
 *
 * Il segreto lo verifica `cronGuard` in `hooks.server.ts`.
 */
export const POST: RequestHandler = async () => {
	const inizio = Date.now();
	const adesso = new Date();
	const db = getDb();

	const avvisi = await avvisiDigest(db, adesso);
	const esito = await notifica(db, avvisi);

	return json(
		{
			settimana: etichettaSettimana(adesso),
			// Chi non aveva niente da leggere non compare: `avvisiDigest`
			// restituisce un avviso solo per chi ha almeno una riga.
			destinatari: avvisi.length,
			...esito,
			durataMs: Date.now() - inizio
		},
		{ headers: { 'Cache-Control': 'private, no-store' } }
	);
};
