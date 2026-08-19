import { fail, redirect } from '@sveltejs/kit';
import { formValues } from '$lib/server/forms';
import { getDb } from '$lib/server/db/client';
import { venues } from '$lib/server/db/schema';
import { findVenueDuplicates } from '$lib/server/catalog/venues';
import { geocode } from '$lib/server/geocode';
import { normalizeName } from '$lib/server/text';
import { venueSchema } from '$lib/schemas/venue';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const viewer = locals.viewer;
		if (!viewer) return fail(401, { error: 'Sessione non valida.' });

		const form = await request.formData();
		const grezzi = formValues(form);

		// Le coordinate possono arrivare dal geocoding lato client oppure a
		// mano. Se mancano, proviamo qui: il form non deve mai bloccarsi
		// perché un servizio esterno non risponde (principio 5).
		let lat = Number(form.get('lat'));
		let lon = Number(form.get('lon'));
		let geocodeSource = String(form.get('geocodeSource') ?? '') || null;
		let geocodeQuery = String(form.get('geocodeQuery') ?? '') || null;

		const db = getDb();

		if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) {
			const query = [form.get('address'), form.get('city'), form.get('province'), 'Italia']
				.filter(Boolean)
				.join(', ');
			try {
				const posizione = await geocode(db, query);
				if (posizione) {
					lat = posizione.lat;
					lon = posizione.lon;
					geocodeSource = posizione.source;
					geocodeQuery = query;
				}
			} catch (err) {
				console.error('Geocoding locale non riuscito:', err);
			}
		}

		const parsed = venueSchema.safeParse({ ...grezzi, lat, lon });
		if (!parsed.success) {
			const primo = parsed.error.issues[0];
			return fail(400, {
				error:
					primo?.path[0] === 'lat' || primo?.path[0] === 'lon'
						? 'Non siamo riusciti a trovare le coordinate. Inseriscile a mano, oppure prova con un indirizzo più preciso.'
						: (primo?.message ?? 'Dati non validi.'),
				valori: grezzi
			});
		}

		const dati = parsed.data;

		// Avviso, non blocco: un doppione si unisce, un inserimento negato si
		// perde. Se l'utente conferma, andiamo avanti.
		if (form.get('confermaDoppione') !== '1') {
			const doppioni = await findVenueDuplicates(db, dati.name, dati.city);
			if (doppioni.length) {
				return fail(409, { doppioni, valori: grezzi, error: null });
			}
		}

		const creato = await db
			.insert(venues)
			.values({
				name: dati.name,
				nameNormalized: normalizeName(dati.name),
				address: dati.address,
				city: dati.city,
				province: dati.province,
				region: dati.region,
				postalCode: dati.postalCode,
				country: dati.country,
				lat: dati.lat,
				lon: dati.lon,
				capacity: dati.capacity,
				website: dati.website,
				instagramUrl: dati.instagramUrl,
				facebookUrl: dati.facebookUrl,
				phone: dati.phone,
				email: dati.email,
				notes: dati.notes,
				geocodeSource,
				geocodeQuery,
				geocodedAt: geocodeSource ? new Date() : null,
				createdBy: viewer.profileId
			})
			.returning({ id: venues.id });

		redirect(303, `/venues/${creato[0].id}`);
	}
};
