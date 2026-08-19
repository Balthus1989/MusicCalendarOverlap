import { error, json, type RequestHandler } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/client';
import { OSM_ATTRIBUTION, geocode } from '$lib/server/geocode';

/**
 * Geocoding per il form dei locali.
 *
 * Solo per utenti autenticati: Photon e Nominatim hanno rate limit stretti e
 * questo endpoint è un proxy verso di loro. Il rate limit per profilo previsto
 * da ARCHITECTURE.md §16 arriva in Fase 6, insieme agli altri.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.session) error(401, 'Serve una sessione.');

	const q = url.searchParams.get('q')?.trim() ?? '';
	if (q.length < 3) return json({ risultato: null, attribuzione: OSM_ATTRIBUTION });

	try {
		const risultato = await geocode(getDb(), q);
		return json(
			{ risultato, attribuzione: OSM_ATTRIBUTION },
			// Il risultato è già in cache su DB; questo evita solo di ripetere
			// la stessa query mentre l'utente compila il form.
			{ headers: { 'Cache-Control': 'private, max-age=300' } }
		);
	} catch (err) {
		// GEOCODER_USER_AGENT mancante finisce qui. Non è un errore dell'utente
		// e non deve bloccare il form: le coordinate si inseriscono a mano.
		console.error('Geocoding non disponibile:', err);
		return json({ risultato: null, attribuzione: OSM_ATTRIBUTION, indisponibile: true });
	}
};
