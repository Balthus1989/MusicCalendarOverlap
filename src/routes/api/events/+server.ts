import { error, json, type RequestHandler } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/client';
import { aEventoCalendario } from '$lib/server/events/calendar';
import { elencaEventi } from '$lib/server/events/queries';
import { serializeEvents } from '$lib/server/visibility';
import { statoEvento } from '$lib/schemas/event';

/**
 * Eventi visibili in una finestra, per il calendario.
 *
 * FullCalendar chiede una finestra alla volta mentre l'utente naviga fra i
 * mesi: caricarne dodici in anticipo sarebbe più semplice ma farebbe
 * viaggiare dati che nessuno guarderà.
 *
 * L'endpoint non restituisce mai righe grezze: `serializeEvents` prima,
 * `aEventoCalendario` poi. Vale anche qui il vincolo di ADR-0005.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const viewer = locals.viewer;
	if (!viewer) error(401, 'Serve una sessione.');

	const da = new Date(url.searchParams.get('da') ?? '');
	const a = new Date(url.searchParams.get('a') ?? '');
	if (Number.isNaN(da.getTime()) || Number.isNaN(a.getTime())) {
		error(400, 'Finestra temporale non valida.');
	}

	const stati = url.searchParams
		.getAll('stato')
		.map((s) => statoEvento.safeParse(s))
		.filter((r) => r.success)
		.map((r) => r.data);

	const raggio = Number(url.searchParams.get('raggio') ?? '');
	const lat = Number(url.searchParams.get('lat') ?? '');
	const lon = Number(url.searchParams.get('lon') ?? '');
	const centro =
		Number.isFinite(lat) && Number.isFinite(lon) && url.searchParams.has('lat')
			? { lat, lon }
			: null;

	const eventi = await elencaEventi(getDb(), viewer, {
		da,
		a,
		statuses: stati.length ? stati : undefined,
		organizationIds: url.searchParams.getAll('org').filter(Boolean),
		genreSlugs: url.searchParams.getAll('genere').filter(Boolean),
		centro,
		raggioKm: Number.isFinite(raggio) && raggio > 0 ? raggio : null
	});

	return json(serializeEvents(eventi, viewer).map(aEventoCalendario), {
		// Il contenuto dipende da chi guarda: una cache condivisa qui sarebbe
		// il modo più rapido di mostrare a un'organizzazione i dati di un'altra.
		headers: { 'Cache-Control': 'private, no-store' }
	});
};
