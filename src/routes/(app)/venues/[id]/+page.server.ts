import { error, fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { canEditCatalogEntry, canModerateCatalog } from '$lib/server/auth/permissions';
import { getDb } from '$lib/server/db/client';
import { profiles, venues } from '$lib/server/db/schema';
import { normalizeName } from '$lib/server/text';
import { venueSchema } from '$lib/schemas/venue';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
	const { viewer } = await parent();
	const db = getDb();

	const righe = await db
		.select({ venue: venues, autore: profiles.displayName })
		.from(venues)
		.leftJoin(profiles, eq(profiles.id, venues.createdBy))
		.where(eq(venues.id, params.id))
		.limit(1);

	const riga = righe[0];
	if (!riga) error(404, 'Locale non trovato.');

	// I venue non hanno il flag `is_verified`: la voce è modificabile da chi
	// l'ha creata o da un moderatore.
	const puoModificare = canEditCatalogEntry(viewer, {
		createdBy: riga.venue.createdBy,
		isVerified: false
	});

	return {
		venue: riga.venue,
		autore: riga.autore,
		puoModificare,
		puoModerare: canModerateCatalog(viewer)
	};
};

export const actions: Actions = {
	salva: async ({ request, params, locals }) => {
		const viewer = locals.viewer;
		if (!viewer) return fail(401, { error: 'Sessione non valida.' });

		const db = getDb();
		const esistente = await db
			.select({ createdBy: venues.createdBy })
			.from(venues)
			.where(eq(venues.id, params.id))
			.limit(1);

		if (!esistente[0]) return fail(404, { error: 'Locale non trovato.' });

		if (!canEditCatalogEntry(viewer, { createdBy: esistente[0].createdBy, isVerified: false })) {
			return fail(403, {
				error:
					'Questa scheda l’ha inserita un altro organizzatore. Serve il ruolo di moderatore per modificarla.'
			});
		}

		const form = await request.formData();
		const parsed = venueSchema.safeParse({
			...Object.fromEntries(form),
			lat: Number(form.get('lat')),
			lon: Number(form.get('lon'))
		});

		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Dati non validi.' });
		}

		const d = parsed.data;
		await db
			.update(venues)
			.set({
				name: d.name,
				nameNormalized: normalizeName(d.name),
				address: d.address,
				city: d.city,
				province: d.province,
				region: d.region,
				postalCode: d.postalCode,
				country: d.country,
				lat: d.lat,
				lon: d.lon,
				capacity: d.capacity,
				website: d.website,
				instagramUrl: d.instagramUrl,
				facebookUrl: d.facebookUrl,
				phone: d.phone,
				email: d.email,
				notes: d.notes,
				updatedAt: new Date()
			})
			.where(eq(venues.id, params.id));

		return { salvato: true };
	}
};
