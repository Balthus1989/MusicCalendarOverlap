import { error, json, type RequestHandler } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import { getDb } from '$lib/server/db/client';
import { caricaEvento } from '$lib/server/events/queries';
import { generaCopy, isPiattaforma } from '$lib/server/social/copy';
import { serializeEvent } from '$lib/server/visibility';

/**
 * Copy pronto da copiare per una piattaforma (ARCHITECTURE.md §8, ADR-0012).
 *
 * **Non pubblica niente**, e non c'è nessun `POST` qui: la creazione
 * programmatica di eventi su Meta non è disponibile, e questa è la
 * sostituzione onesta. Restituisce testo.
 *
 * Non serve essere l'organizzazione proprietaria: di una data confermata si
 * vede già tutto, e capita di rilanciare la serata di un altro. Ciò che serve
 * è vederla per intero — di un `hold` altrui non c'è niente da annunciare, e
 * la risposta lo dice invece di restituire un testo con dei buchi.
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	const viewer = locals.viewer;
	if (!viewer) error(401, 'Serve una sessione.');

	const piattaforma = url.searchParams.get('platform') ?? '';
	if (!isPiattaforma(piattaforma)) {
		error(400, 'Piattaforma non riconosciuta: instagram, facebook o telegram.');
	}

	const evento = await caricaEvento(getDb(), params.id!);
	if (!evento) error(404, 'Data non trovata.');

	const serializzato = serializeEvent(evento, viewer);
	if (!serializzato) error(404, 'Data non trovata.');

	const baseUrl = (publicEnv.PUBLIC_APP_URL ?? url.origin).replace(/\/+$/, '');
	const copy = generaCopy(serializzato, piattaforma, baseUrl);

	if (!copy) {
		return json(
			{
				copy: null,
				motivo:
					'Questa data è opzionata da un’altra organizzazione: finché non la conferma non c’è niente da annunciare.'
			},
			{ headers: { 'Cache-Control': 'private, no-store' } }
		);
	}

	return json({ copy }, { headers: { 'Cache-Control': 'private, no-store' } });
};
