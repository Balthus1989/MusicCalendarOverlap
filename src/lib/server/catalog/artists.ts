/**
 * Anagrafica artisti: ricerca, deduplica, scrittura.
 *
 * La deduplica è il punto delicato (ADR-0006): l'MBID è la chiave forte, il
 * nome normalizzato è la rete di sicurezza per chi un MBID non ce l'ha.
 */
import { and, asc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { Database } from '$lib/server/db/client';
import { artistGenres, artists, genres, type Artist } from '$lib/server/db/schema';
import { looksLikeDuplicate, normalizeName } from '$lib/server/text';

export type ArtistListItem = {
	id: string;
	name: string;
	mbid: string | null;
	country: string | null;
	isVerified: boolean;
	generi: string[];
};

/** Ricerca locale, per l'autocomplete e per la lista. */
export async function searchLocalArtists(
	db: Database,
	query: string,
	limit = 25
): Promise<ArtistListItem[]> {
	const q = query.trim();

	const righe = await db
		.select({
			id: artists.id,
			name: artists.name,
			mbid: artists.mbid,
			country: artists.country,
			isVerified: artists.isVerified,
			genere: genres.name
		})
		.from(artists)
		.leftJoin(artistGenres, eq(artistGenres.artistId, artists.id))
		.leftJoin(genres, eq(genres.id, artistGenres.genreId))
		.where(
			q
				? or(ilike(artists.name, `%${q}%`), ilike(artists.nameNormalized, `%${normalizeName(q)}%`))
				: undefined
		)
		.orderBy(asc(artists.name))
		.limit(limit * 6);

	// Il join sui generi moltiplica le righe: le ricomponiamo qui invece di
	// fare N+1 query.
	const perId = new Map<string, ArtistListItem>();
	for (const r of righe) {
		let voce = perId.get(r.id);
		if (!voce) {
			voce = {
				id: r.id,
				name: r.name,
				mbid: r.mbid,
				country: r.country,
				isVerified: r.isVerified,
				generi: []
			};
			perId.set(r.id, voce);
		}
		if (r.genere && !voce.generi.includes(r.genere)) voce.generi.push(r.genere);
	}

	return [...perId.values()].slice(0, limit);
}

export type DuplicateHint = {
	id: string;
	name: string;
	mbid: string | null;
	motivo: 'mbid' | 'nome-identico' | 'nome-simile';
};

/**
 * Cerca possibili doppioni prima di inserire.
 *
 * Non blocca: restituisce indizi da mostrare, coerentemente con la filosofia
 * del prodotto — avvisare due pari, non dare a uno il potere di veto.
 */
export async function findDuplicates(
	db: Database,
	name: string,
	mbid: string | null,
	escludiId?: string
): Promise<DuplicateHint[]> {
	const normalizzato = normalizeName(name);
	if (!normalizzato) return [];

	const condizioni = [
		mbid ? eq(artists.mbid, mbid) : undefined,
		eq(artists.nameNormalized, normalizzato),
		// Prefisso: prende i refusi in coda, non quelli in testa. Il filtro
		// fine lo fa `looksLikeDuplicate` sotto.
		sql`${artists.nameNormalized} like ${normalizzato.slice(0, 4) + '%'}`
	].filter(Boolean);

	const candidati = await db
		.select({
			id: artists.id,
			name: artists.name,
			nameNormalized: artists.nameNormalized,
			mbid: artists.mbid
		})
		.from(artists)
		.where(and(or(...condizioni), escludiId ? ne(artists.id, escludiId) : undefined))
		.limit(40);

	const esiti: DuplicateHint[] = [];
	for (const c of candidati) {
		if (mbid && c.mbid === mbid) {
			esiti.push({ id: c.id, name: c.name, mbid: c.mbid, motivo: 'mbid' });
		} else if (c.nameNormalized === normalizzato) {
			esiti.push({ id: c.id, name: c.name, mbid: c.mbid, motivo: 'nome-identico' });
		} else if (looksLikeDuplicate(c.name, name)) {
			esiti.push({ id: c.id, name: c.name, mbid: c.mbid, motivo: 'nome-simile' });
		}
	}

	// Un match su MBID è certo: se c'è, gli altri indizi sono rumore.
	const certo = esiti.find((e) => e.motivo === 'mbid');
	return certo ? [certo] : esiti.slice(0, 5);
}

/** Sostituisce l'insieme dei generi di un artista; il primo slug è il primario. */
export async function setArtistGenres(db: Database, artistId: string, slugs: string[]) {
	await db.delete(artistGenres).where(eq(artistGenres.artistId, artistId));
	if (!slugs.length) return;

	const trovati = await db
		.select({ id: genres.id, slug: genres.slug })
		.from(genres)
		// `sql`... = any(${slugs})`` NON funziona: Drizzle interpola un array
		// JS come tupla `($1, $2)`, che in `any()` e' SQL non valido. `inArray`
		// genera la clausola corretta.
		.where(inArray(genres.slug, slugs));

	const bySlug = new Map(trovati.map((g) => [g.slug, g.id]));
	const righe = slugs
		.map((slug, i) => {
			const genreId = bySlug.get(slug);
			return genreId ? { artistId, genreId, isPrimary: i === 0 } : null;
		})
		.filter((r): r is { artistId: string; genreId: string; isPrimary: boolean } => r !== null);

	if (righe.length) await db.insert(artistGenres).values(righe).onConflictDoNothing();
}

/** Artisti senza MBID: i candidati naturali all'arricchimento da MusicBrainz. */
export async function countUnlinked(db: Database): Promise<number> {
	const r = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(artists)
		.where(isNull(artists.mbid));
	return r[0]?.n ?? 0;
}

export type { Artist };
