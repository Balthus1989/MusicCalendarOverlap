import { getDb } from '$lib/server/db/client';
import { countUnlinked, searchLocalArtists } from '$lib/server/catalog/artists';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const q = url.searchParams.get('q') ?? '';
	const db = getDb();
	return {
		q,
		artists: await searchLocalArtists(db, q, 60),
		senzaMbid: await countUnlinked(db)
	};
};
