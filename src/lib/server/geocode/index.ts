/**
 * Geocoding: Photon (Komoot) con fallback Nominatim, risultati cacheati su DB.
 *
 * Vincoli d'uso, non opzionali:
 * - entrambi i servizi girano su dati OSM e chiedono un `User-Agent` che
 *   identifichi l'applicazione con un contatto reale (`GEOCODER_USER_AGENT`);
 * - Nominatim ammette **una richiesta al secondo**: è il motivo per cui il
 *   fallback si usa solo quando Photon non risponde, e per cui ogni risultato
 *   finisce in `geocode_cache`;
 * - dove si mostrano questi dati serve l'attribuzione OSM.
 *
 * Degradazione elegante (principio 5): se entrambi falliscono, la funzione
 * restituisce `null` e l'inserimento manuale delle coordinate resta possibile.
 */
import { env } from '$env/dynamic/private';
import { eq } from 'drizzle-orm';
import type { Database } from '$lib/server/db/client';
import { geocodeCache } from '$lib/server/db/schema';
import { normalizeGeocodeQuery } from '$lib/server/text';

export type GeocodeResult = {
	lat: number;
	lon: number;
	/** Etichetta leggibile restituita dal servizio. */
	label: string;
	city: string | null;
	province: string | null;
	region: string | null;
	postalCode: string | null;
	country: string | null;
	source: 'photon' | 'nominatim' | 'cache';
};

const TIMEOUT_MS = 6000;
const PHOTON_DEFAULT = 'https://photon.komoot.io';
const NOMINATIM = 'https://nominatim.openstreetmap.org';

function userAgent(): string {
	const ua = env.GEOCODER_USER_AGENT?.trim();
	if (ua) return ua;
	// Un User-Agent generico è esplicitamente vietato dalla policy Nominatim.
	// Meglio fallire il geocoding che farsi bloccare l'IP del Worker.
	throw new Error(
		'GEOCODER_USER_AGENT non configurata. Photon e Nominatim richiedono un contatto reale nello User-Agent.'
	);
}

async function fetchJson(url: string): Promise<unknown | null> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			signal: ctrl.signal,
			headers: { 'User-Agent': userAgent(), Accept: 'application/json' }
		});
		if (!res.ok) return null;
		return await res.json();
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/* ---------------- Photon ---------------- */

type PhotonFeature = {
	geometry?: { coordinates?: [number, number] };
	properties?: Record<string, string | undefined>;
};

function parsePhoton(data: unknown): GeocodeResult | null {
	const feat = (data as { features?: PhotonFeature[] })?.features?.[0];
	const coords = feat?.geometry?.coordinates;
	if (!feat || !coords || coords.length < 2) return null;

	const p = feat.properties ?? {};
	const label = [p.name, p.street, p.city, p.state, p.country].filter(Boolean).join(', ');

	return {
		// GeoJSON è [lon, lat], non [lat, lon]. È l'inversione che si sbaglia
		// una volta e si insegue per un pomeriggio.
		lon: coords[0],
		lat: coords[1],
		label: label || (p.name ?? ''),
		city: p.city ?? p.district ?? null,
		province: p.county ?? null,
		region: p.state ?? null,
		postalCode: p.postcode ?? null,
		country: p.countrycode?.toUpperCase() ?? null,
		source: 'photon'
	};
}

/* ---------------- Nominatim ---------------- */

type NominatimItem = {
	lat?: string;
	lon?: string;
	display_name?: string;
	address?: Record<string, string | undefined>;
};

function parseNominatim(data: unknown): GeocodeResult | null {
	const item = (data as NominatimItem[])?.[0];
	if (!item?.lat || !item?.lon) return null;

	const a = item.address ?? {};
	return {
		lat: Number(item.lat),
		lon: Number(item.lon),
		label: item.display_name ?? '',
		city: a.city ?? a.town ?? a.village ?? a.municipality ?? null,
		province: a.county ?? null,
		region: a.state ?? null,
		postalCode: a.postcode ?? null,
		country: a.country_code?.toUpperCase() ?? null,
		source: 'nominatim'
	};
}

/* ---------------- API pubblica ---------------- */

/**
 * Risolve una query in coordinate. Consulta prima la cache; interroga la rete
 * solo se non trova nulla, e scrive in cache ogni risultato ottenuto.
 */
export async function geocode(db: Database, query: string): Promise<GeocodeResult | null> {
	const chiave = normalizeGeocodeQuery(query);
	if (!chiave) return null;

	const cached = await db
		.select()
		.from(geocodeCache)
		.where(eq(geocodeCache.queryNormalized, chiave))
		.limit(1);

	if (cached[0]) {
		const p = (cached[0].payload ?? {}) as Partial<GeocodeResult>;
		return {
			lat: cached[0].lat,
			lon: cached[0].lon,
			label: p.label ?? query,
			city: p.city ?? null,
			province: p.province ?? null,
			region: p.region ?? null,
			postalCode: p.postalCode ?? null,
			country: p.country ?? null,
			source: 'cache'
		};
	}

	const base = env.GEOCODER_BASE_URL?.trim() || PHOTON_DEFAULT;
	const q = encodeURIComponent(query);

	const risultato =
		// Niente `lang=it`: Photon accetta solo `default`, `de`, `en`, `fr` e
		// risponde 400 su tutto il resto. Con un parametro non supportato il
		// geocoder primario fallisce *sempre* e ogni richiesta ricade su
		// Nominatim, che e' il fallback e ammette una richiesta al secondo.
		// `default` restituisce comunque i toponimi nella lingua locale.
		parsePhoton(await fetchJson(`${base}/api?q=${q}&limit=1`)) ??
		parseNominatim(
			await fetchJson(`${NOMINATIM}/search?q=${q}&format=json&addressdetails=1&limit=1`)
		);

	if (!risultato) return null;

	// Coordinate fuori range = risposta malformata, non un luogo.
	if (
		!Number.isFinite(risultato.lat) ||
		!Number.isFinite(risultato.lon) ||
		Math.abs(risultato.lat) > 90 ||
		Math.abs(risultato.lon) > 180
	) {
		return null;
	}

	await db
		.insert(geocodeCache)
		.values({
			queryNormalized: chiave,
			lat: risultato.lat,
			lon: risultato.lon,
			source: risultato.source,
			payload: risultato
		})
		.onConflictDoNothing({ target: geocodeCache.queryNormalized });

	return risultato;
}

/** Testo di attribuzione obbligatorio dove si mostrano questi dati. */
export const OSM_ATTRIBUTION = 'Dati geografici © contributori OpenStreetMap';
