import { error, json, type RequestHandler } from '@sveltejs/kit';
import { bozzaConflittiSchema } from '$lib/schemas/conflict';
import { anteprimaConflitti } from '$lib/server/conflicts/preview';
import { getDb } from '$lib/server/db/client';
import { formValues, righeIndicizzate, valoriMultipli } from '$lib/server/forms';

/**
 * Conflitti su una bozza non ancora salvata (ARCHITECTURE.md §6.5).
 *
 * Riceve **lo stesso `FormData` del form evento**, non un JSON costruito a
 * parte. È una scelta deliberata: leggere la bozza con le stesse funzioni con
 * cui la legge il salvataggio (`formValues`, `righeIndicizzate`) è l'unico
 * modo per essere sicuri che l'anteprima parli della stessa data che si sta
 * per salvare. Due lettori diversi dello stesso form divergono, e il primo
 * conflitto che l'anteprima manca insegna a non fidarsene più.
 *
 * Chiamato con debounce di 600 ms dai soli campi rilevanti: data, luogo,
 * generi, lineup. È un `POST` perché manda una bozza, non perché scriva
 * qualcosa — l'unico effetto collaterale possibile è una riga in
 * `geocode_cache`.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const viewer = locals.viewer;
	if (!viewer) error(401, 'Serve una sessione.');

	const form = await request.formData();

	const parsed = bozzaConflittiSchema.safeParse({
		...formValues(form),
		secondaryGenreSlugs: valoriMultipli(form, 'secondaryGenreSlugs'),
		lineup: righeIndicizzate(form, 'lineup')
	});

	if (!parsed.success) {
		// Un form a metà non è un errore: è la condizione normale mentre si
		// scrive. Si risponde 200 con la spiegazione, così l'interfaccia
		// mostra una riga di testo invece di un messaggio d'errore rosso.
		return json(
			{ conflitti: [], incompleto: 'Mancano ancora dei dati per poter controllare.' },
			{ headers: { 'Cache-Control': 'private, no-store' } }
		);
	}

	const esito = await anteprimaConflitti(getDb(), viewer, parsed.data);

	return json(esito, {
		// Dipende da chi guarda: una cache condivisa mostrerebbe a
		// un'organizzazione i conflitti di un'altra.
		headers: { 'Cache-Control': 'private, no-store' }
	});
};
