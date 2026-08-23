import { error, type RequestHandler } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import { getDb } from '$lib/server/db/client';
import { elencaEventi } from '$lib/server/events/queries';
import { esportaCsv, nomeFileExport } from '$lib/server/export/csv';
import { esportaJson } from '$lib/server/export/json';
import { esportaJsonLd } from '$lib/server/export/jsonld';
import { serializeEvents } from '$lib/server/visibility';

/**
 * Export massivo (ARCHITECTURE.md §8, principio 6: nessun lock-in).
 *
 * Esporta **ciò che chi chiede può già vedere**, non "tutto": passa da
 * `serializeEvents` come qualunque altra uscita, quindi una data opzionata
 * altrui esce ridotta a giorno, città e genere anche in un file CSV. Un
 * export che scavalcasse la matrice sarebbe il modo più comodo di aggirarla.
 */
const FORMATI = ['json', 'csv', 'jsonld'] as const;
type Formato = (typeof FORMATI)[number];

/** Se non si chiede una finestra: dai tre mesi passati ai diciotto futuri. */
function finestraPredefinita(adesso: Date): { da: Date; a: Date } {
	const da = new Date(adesso);
	da.setUTCMonth(da.getUTCMonth() - 3);
	const a = new Date(adesso);
	a.setUTCMonth(a.getUTCMonth() + 18);
	return { da, a };
}

function dataParametro(valore: string | null, predefinita: Date): Date {
	if (!valore) return predefinita;
	const d = new Date(valore);
	return Number.isNaN(d.getTime()) ? predefinita : d;
}

export const GET: RequestHandler = async ({ url, locals, setHeaders }) => {
	const viewer = locals.viewer;
	if (!viewer) error(401, 'Serve una sessione.');

	const richiesto = (url.searchParams.get('format') ?? 'json') as Formato;
	if (!FORMATI.includes(richiesto)) error(400, 'Formato non riconosciuto: json, csv o jsonld.');

	const adesso = new Date();
	const predefinita = finestraPredefinita(adesso);
	const da = dataParametro(url.searchParams.get('from'), predefinita.da);
	const a = dataParametro(url.searchParams.get('to'), predefinita.a);
	if (da.getTime() > a.getTime()) error(400, 'La data iniziale è successiva a quella finale.');

	const baseUrl = (publicEnv.PUBLIC_APP_URL ?? url.origin).replace(/\/+$/, '');
	const eventi = serializeEvents(await elencaEventi(getDb(), viewer, { da, a }), viewer);

	setHeaders({ 'Cache-Control': 'private, no-store' });

	if (richiesto === 'csv') {
		return new Response(esportaCsv(eventi, { baseUrl }), {
			headers: {
				'Content-Type': 'text/csv; charset=utf-8',
				'Content-Disposition': `attachment; filename="${nomeFileExport('csv', da, a)}"`
			}
		});
	}

	const corpo =
		richiesto === 'jsonld'
			? esportaJsonLd(eventi, { baseUrl })
			: esportaJson(eventi, { baseUrl, da, a, adesso });

	return new Response(JSON.stringify(corpo, null, '\t'), {
		headers: {
			'Content-Type':
				richiesto === 'jsonld'
					? 'application/ld+json; charset=utf-8'
					: 'application/json; charset=utf-8',
			'Content-Disposition': `attachment; filename="${nomeFileExport(richiesto === 'jsonld' ? 'jsonld' : 'json', da, a)}"`
		}
	});
};
