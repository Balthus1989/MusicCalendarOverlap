import { error, type RequestHandler } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import { getDb } from '$lib/server/db/client';
import { caricaEvento } from '$lib/server/events/queries';
import { costruisciCalendario, nomeFileIcs } from '$lib/server/ics/build';
import { serializeEvent } from '$lib/server/visibility';

/**
 * Download ICS di una singola data (ARCHITECTURE.md §8).
 *
 * A differenza del feed questo endpoint **richiede una sessione**: non è
 * sottoscritto da un client calendario, lo scarica una persona che sta
 * guardando la pagina della data. Non c'è nessun token da inventare.
 *
 * Un file, non un feed: niente `REFRESH-INTERVAL` che possa contare, perché
 * un `.ics` scaricato non si aggiorna più. Il `SEQUENCE` c'è lo stesso, così
 * chi riscarica lo stesso evento dopo una modifica sovrascrive la copia
 * vecchia invece di ritrovarsi due date.
 */
export const GET: RequestHandler = async ({ params, url, locals, setHeaders }) => {
	const viewer = locals.viewer;
	if (!viewer) error(401, 'Serve una sessione.');

	const evento = await caricaEvento(getDb(), params.id!);
	if (!evento) error(404, 'Data non trovata.');

	// `null` significa "per questo viewer non esiste": 404, non 403. La stessa
	// scelta della pagina di dettaglio.
	const serializzato = serializeEvent(evento, viewer);
	if (!serializzato) error(404, 'Data non trovata.');

	const baseUrl = (publicEnv.PUBLIC_APP_URL ?? url.origin).replace(/\/+$/, '');
	const ics = costruisciCalendario([{ evento: serializzato, aggiornatoIl: evento.updatedAt }], {
		nome: 'Calendario Eventi Condiviso',
		baseUrl
	});

	setHeaders({
		'Content-Type': 'text/calendar; charset=utf-8',
		'Cache-Control': 'private, no-store',
		'Content-Disposition': `attachment; filename="${nomeFileIcs(serializzato)}"`
	});

	return new Response(ics);
};
