/**
 * Completamento del profilo dell'organizzazione.
 *
 * L'invito crea l'organizzazione con il solo nome. Qui si aggiungono i dati
 * che servono davvero al calendario: la città (che dà le coordinate di base
 * per i conflitti geografici) e il raggio.
 */
import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { canEditOrg } from '$lib/server/auth/permissions';
import { getDb } from '$lib/server/db/client';
import { organizations } from '$lib/server/db/schema';
import { geocode } from '$lib/server/geocode';
import { organizationSchema } from '$lib/schemas/organization';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { organizations: orgs, viewer } = await parent();

	if (orgs.length === 0) {
		return { senzaOrganizzazione: true as const, org: null, completo: false };
	}

	// Con più organizzazioni, l'onboarding riguarda la prima incompleta.
	const daCompletare = orgs.find((o) => !o.city || o.lat === null) ?? orgs[0];
	const db = getDb();
	const righe = await db
		.select()
		.from(organizations)
		.where(eq(organizations.id, daCompletare.id))
		.limit(1);

	const org = righe[0];
	if (!org) redirect(303, '/calendar');

	return {
		senzaOrganizzazione: false as const,
		org: {
			id: org.id,
			name: org.name,
			kind: org.kind,
			city: org.city ?? '',
			province: org.province ?? '',
			region: org.region ?? '',
			country: org.country,
			website: org.website ?? '',
			instagramUrl: org.instagramUrl ?? '',
			facebookUrl: org.facebookUrl ?? '',
			emailContact: org.emailContact ?? '',
			defaultConflictRadiusKm: org.defaultConflictRadiusKm,
			notes: org.notes ?? '',
			lat: org.lat,
			lon: org.lon
		},
		completo: Boolean(org.city && org.lat !== null),
		puoModificare: canEditOrg(viewer, org.id)
	};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const viewer = locals.viewer;
		if (!viewer) return fail(401, { error: 'Sessione non valida.' });

		const form = await request.formData();
		const organizationId = String(form.get('organizationId') ?? '');

		if (!canEditOrg(viewer, organizationId)) {
			return fail(403, { error: 'Non hai i permessi per modificare questa organizzazione.' });
		}

		const parsed = organizationSchema.safeParse(Object.fromEntries(form));
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? 'Dati non validi.',
				campo: parsed.error.issues[0]?.path.join('.')
			});
		}

		const db = getDb();
		const dati = parsed.data;

		// Coordinate di base dell'organizzazione: servono come default per gli
		// eventi senza venue. Se il geocoding non risponde non è bloccante —
		// l'organizzazione resta usabile, il conflitto geografico userà quelle
		// del venue o della città dell'evento.
		let lat: number | null = null;
		let lon: number | null = null;
		try {
			const posizione = await geocode(
				db,
				[dati.city, dati.province, dati.country].filter(Boolean).join(', ')
			);
			if (posizione) {
				lat = posizione.lat;
				lon = posizione.lon;
			}
		} catch (err) {
			console.error('Geocoding organizzazione non riuscito:', err);
		}

		await db
			.update(organizations)
			.set({
				name: dati.name,
				kind: dati.kind,
				city: dati.city,
				province: dati.province,
				region: dati.region,
				country: dati.country,
				website: dati.website,
				instagramUrl: dati.instagramUrl,
				facebookUrl: dati.facebookUrl,
				emailContact: dati.emailContact,
				defaultConflictRadiusKm: dati.defaultConflictRadiusKm,
				notes: dati.notes,
				...(lat !== null && lon !== null ? { lat, lon } : {}),
				updatedAt: new Date()
			})
			.where(eq(organizations.id, organizationId));

		redirect(303, '/org');
	}
};
