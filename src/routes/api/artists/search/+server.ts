import { error, json, type RequestHandler } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/client';
import { searchLocalArtists } from '$lib/server/catalog/artists';
import { describeArtist, searchArtists } from '$lib/server/musicbrainz';

/**
 * Autocomplete artisti: prima l'anagrafica locale, poi — solo su richiesta
 * esplicita (`?remote=1`) — MusicBrainz.
 *
 * La separazione non è un dettaglio: MusicBrainz ammette una richiesta al
 * secondo, quindi non può stare dietro a ogni tasto premuto.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.session) error(401, 'Serve una sessione.');

	const q = url.searchParams.get('q')?.trim() ?? '';
	if (q.length < 2) return json({ locali: [], remoti: [] });

	const locali = await searchLocalArtists(getDb(), q, 10);

	if (url.searchParams.get('remote') !== '1') {
		return json({ locali, remoti: [] });
	}

	const remoti = (await searchArtists(q)).map((a) => ({
		mbid: a.mbid,
		name: a.name,
		descrizione: describeArtist(a),
		country: a.country,
		beginYear: a.beginYear,
		/** Vero se quell'MBID è già in anagrafica: evita il doppio inserimento. */
		giaPresente: locali.some((l) => l.mbid === a.mbid)
	}));

	return json({ locali, remoti });
};
