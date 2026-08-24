import { error, json, type RequestHandler } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/client';
import { OSM_ATTRIBUTION, geocode } from '$lib/server/geocode';
import { consumaRichiesta } from '$lib/server/ratelimit';

/**
 * Geocoding per il form dei locali.
 *
 * Solo per utenti autenticati, e con un limite per profilo (§16, ADR-0037):
 * Photon e Nominatim hanno una policy d'uso da rispettare, e chi esagera qui
 * fa bloccare l'IP a tutto il progetto — compresa la ricerca artisti, che con
 * il geocoding non c'entra e funziona.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.session) error(401, 'Serve una sessione.');
	const profileId = locals.profile?.id;
	if (!profileId) error(401, 'Serve una sessione.');

	const q = url.searchParams.get('q')?.trim() ?? '';
	// Il conteggio viene **dopo** questo controllo: una query troppo corta non
	// esce da qui, quindi non costa niente a nessuno e non va contata.
	if (q.length < 3) return json({ risultato: null, attribuzione: OSM_ATTRIBUTION });

	const db = getDb();
	const limite = await consumaRichiesta(db, 'geocode', profileId);
	if (!limite.consentito) {
		return json(
			{
				risultato: null,
				attribuzione: OSM_ATTRIBUTION,
				indisponibile: true,
				// Lo stesso campo che il form già mostra quando il geocoder non
				// risponde: da qui in avanti il comportamento è identico, cioè
				// le coordinate si mettono a mano. Non serve un ramo nuovo
				// nell'interfaccia per una condizione che si risolve da sé.
				motivo: 'Troppe ricerche in poco tempo. Riprova fra qualche minuto.'
			},
			{ status: 429, headers: { 'Retry-After': String(limite.riprovaFra) } }
		);
	}

	try {
		const risultato = await geocode(db, q);
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
