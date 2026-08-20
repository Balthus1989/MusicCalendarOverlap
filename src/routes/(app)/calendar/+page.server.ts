import { error } from '@sveltejs/kit';
import { inArray } from 'drizzle-orm';
import { getDb } from '$lib/server/db/client';
import { organizations } from '$lib/server/db/schema';
import { opzioniFiltri } from '$lib/server/events/queries';
import type { PageServerLoad } from './$types';

/**
 * Il calendario carica gli eventi dal client, un mese alla volta, via
 * `/api/events`. Qui si prepara solo ciò che serve a costruire i filtri: i
 * generi e le organizzazioni che compaiono davvero in almeno una data, così
 * che il menu non elenchi trenta generi di cui ventotto vuoti.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const viewer = locals.viewer;
	if (!viewer) error(401, 'Sessione non valida.');

	const db = getDb();
	const { generi, organizzazioni } = await opzioniFiltri(db);

	// Centro predefinito del filtro "entro N km": la sede della prima
	// organizzazione del profilo. È il punto da cui un organizzatore giudica
	// se una data altrui gli dà fastidio.
	const mie = viewer.organizationIds.length
		? await db
				.select({
					id: organizations.id,
					name: organizations.name,
					city: organizations.city,
					lat: organizations.lat,
					lon: organizations.lon,
					defaultConflictRadiusKm: organizations.defaultConflictRadiusKm
				})
				.from(organizations)
				.where(inArray(organizations.id, viewer.organizationIds))
		: [];

	const conCoordinate = mie.find((o) => o.lat !== null && o.lon !== null);

	return {
		generi,
		organizzazioni,
		centro: conCoordinate
			? {
					lat: conCoordinate.lat as number,
					lon: conCoordinate.lon as number,
					etichetta: conCoordinate.city ?? conCoordinate.name,
					raggioPredefinito: conCoordinate.defaultConflictRadiusKm
				}
			: null
	};
};
