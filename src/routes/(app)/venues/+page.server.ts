import { getDb } from '$lib/server/db/client';
import { searchVenues } from '$lib/server/catalog/venues';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const q = url.searchParams.get('q') ?? '';
	return { q, venues: await searchVenues(getDb(), q) };
};
