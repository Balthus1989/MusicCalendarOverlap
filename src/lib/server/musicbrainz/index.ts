/**
 * Ricerca artisti su MusicBrainz.
 *
 * Serve a una cosa sola: procurare l'**MBID**, che è la chiave di deduplica
 * forte dell'anagrafica (ADR-0006). Senza MBID due band omonime sono
 * indistinguibili e l'indice unico su `name_normalized` le blocca a vicenda.
 *
 * Policy MusicBrainz: `User-Agent` identificativo obbligatorio, **una
 * richiesta al secondo**. Non è un servizio da interrogare a ogni tasto
 * premuto: l'autocomplete cerca prima in locale e arriva qui solo su richiesta
 * esplicita.
 */
import { env } from '$env/dynamic/private';

const BASE = 'https://musicbrainz.org/ws/2';
const TIMEOUT_MS = 8000;

export type MusicBrainzArtist = {
	mbid: string;
	name: string;
	disambiguation: string | null;
	type: string | null;
	country: string | null;
	area: string | null;
	beginYear: number | null;
	/** Punteggio 0–100 restituito dalla ricerca. */
	score: number;
};

function userAgent(): string {
	const ua = env.GEOCODER_USER_AGENT?.trim();
	if (ua) return ua;
	throw new Error(
		'GEOCODER_USER_AGENT non configurata. MusicBrainz richiede uno User-Agent con un contatto reale.'
	);
}

type MbArtist = {
	id?: string;
	name?: string;
	disambiguation?: string;
	type?: string;
	country?: string;
	score?: number;
	area?: { name?: string };
	'life-span'?: { begin?: string };
};

/**
 * Cerca artisti per nome. Restituisce un array vuoto — mai un errore — se il
 * servizio non risponde: il fallimento non deve mai bloccare l'inserimento
 * manuale (principio 5).
 */
export async function searchArtists(query: string, limit = 8): Promise<MusicBrainzArtist[]> {
	const q = query.trim();
	if (q.length < 2) return [];

	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

	try {
		const url = `${BASE}/artist?query=${encodeURIComponent(q)}&limit=${limit}&fmt=json`;
		const res = await fetch(url, {
			signal: ctrl.signal,
			headers: { 'User-Agent': userAgent(), Accept: 'application/json' }
		});
		if (!res.ok) return [];

		const data = (await res.json()) as { artists?: MbArtist[] };
		return (data.artists ?? [])
			.filter((a): a is MbArtist & { id: string; name: string } => Boolean(a.id && a.name))
			.map((a) => ({
				mbid: a.id,
				name: a.name,
				disambiguation: a.disambiguation || null,
				type: a.type ?? null,
				country: a.country ?? null,
				area: a.area?.name ?? null,
				beginYear: parseYear(a['life-span']?.begin),
				score: typeof a.score === 'number' ? a.score : 0
			}));
	} catch {
		return [];
	} finally {
		clearTimeout(timer);
	}
}

function parseYear(begin: string | undefined): number | null {
	if (!begin) return null;
	const anno = Number(begin.slice(0, 4));
	return Number.isInteger(anno) && anno > 1800 && anno <= 2200 ? anno : null;
}

/**
 * Etichetta per disambiguare due omonimi nella lista di scelta. È l'unica
 * informazione che rende sensata una scelta fra "Fossa (IT, punk)" e
 * "Fossa (SE, black metal)".
 */
export function describeArtist(a: MusicBrainzArtist): string {
	return [a.disambiguation, a.type, a.country ?? a.area, a.beginYear?.toString()]
		.filter(Boolean)
		.join(' · ');
}
