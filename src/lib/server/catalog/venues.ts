/**
 * Anagrafica locali. Come per gli artisti, la deduplica avvisa e non blocca:
 * l'indice su (nome normalizzato, città) non è unique di proposito.
 */
import { and, asc, ilike, ne, or } from 'drizzle-orm';
import type { Database } from '$lib/server/db/client';
import { venues, type Venue } from '$lib/server/db/schema';
import { looksLikeDuplicate, normalizeName } from '$lib/server/text';

export type VenueListItem = Pick<
	Venue,
	'id' | 'name' | 'city' | 'province' | 'capacity' | 'lat' | 'lon'
>;

export async function searchVenues(
	db: Database,
	query: string,
	limit = 50
): Promise<VenueListItem[]> {
	const q = query.trim();
	return db
		.select({
			id: venues.id,
			name: venues.name,
			city: venues.city,
			province: venues.province,
			capacity: venues.capacity,
			lat: venues.lat,
			lon: venues.lon
		})
		.from(venues)
		.where(
			q
				? or(
						ilike(venues.name, `%${q}%`),
						ilike(venues.city, `%${q}%`),
						ilike(venues.nameNormalized, `%${normalizeName(q)}%`)
					)
				: undefined
		)
		.orderBy(asc(venues.city), asc(venues.name))
		.limit(limit);
}

export type VenueDuplicateHint = { id: string; name: string; city: string };

/** Possibili doppioni: stesso nome, o nome molto simile, nella stessa città. */
export async function findVenueDuplicates(
	db: Database,
	name: string,
	city: string,
	escludiId?: string
): Promise<VenueDuplicateHint[]> {
	if (!name.trim() || !city.trim()) return [];

	const candidati = await db
		.select({
			id: venues.id,
			name: venues.name,
			city: venues.city
		})
		.from(venues)
		.where(and(ilike(venues.city, city.trim()), escludiId ? ne(venues.id, escludiId) : undefined))
		.limit(60);

	return candidati
		.filter((c) => looksLikeDuplicate(c.name, name))
		.slice(0, 5)
		.map((c) => ({ id: c.id, name: c.name, city: c.city }));
}

export type { Venue };
