import { error, redirect } from '@sveltejs/kit';
import { inArray } from 'drizzle-orm';
import { canModerateCatalog } from '$lib/server/auth/permissions';
import { haConflittiDaTrattare } from '$lib/server/conflicts/queries';
import { getDb } from '$lib/server/db/client';
import { organizations } from '$lib/server/db/schema';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, route }) => {
	// `authGuard` in hooks.server.ts ha già rediretto se la sessione manca.
	if (!locals.user) error(401, 'Sessione non valida.');

	// Profilo e viewer arrivano da hooks.server.ts: qui non si riquerya.
	const { profile, viewer } = locals;
	if (!profile || !viewer) error(401, 'Contesto utente non disponibile.');

	const db = getDb();
	const orgIds = viewer.organizationIds;

	// Senza organizzazione non c'è niente da mostrare: un profilo arriva qui
	// solo passando da un invito, e l'invito crea sempre una membership.
	// Se manca, qualcosa è andato storto a metà: l'onboarding lo spiega.
	//
	// Il platform admin è l'eccezione, ed è l'eccezione che fa esistere tutto
	// il resto: al primo avvio non c'è nessuna organizzazione al mondo, e
	// l'unico modo per crearne una è un invito che solo lui può generare.
	// Mandarlo all'onboarding lo chiuderebbe fuori dal proprio calendario.
	if (orgIds.length === 0) {
		const rottaAmmessa = route.id === '/(app)/onboarding' || route.id?.startsWith('/(app)/admin');
		if (!rottaAmmessa) {
			redirect(303, viewer.isPlatformAdmin ? '/admin/invites' : '/onboarding');
		}
	}

	const orgs = orgIds.length
		? await db
				.select({
					id: organizations.id,
					name: organizations.name,
					slug: organizations.slug,
					city: organizations.city,
					province: organizations.province,
					lat: organizations.lat,
					defaultConflictRadiusKm: organizations.defaultConflictRadiusKm
				})
				.from(organizations)
				.where(inArray(organizations.id, orgIds))
		: [];

	return {
		viewer,
		profile: {
			id: profile.id,
			displayName: profile.displayName,
			email: profile.email,
			isPlatformAdmin: profile.isPlatformAdmin
		},
		organizations: orgs.map((o) => ({ ...o, role: viewer.roles[o.id] })),
		puoModerare: canModerateCatalog(viewer),
		// Un booleano e non un conteggio: la query gira su ogni pagina, e per
		// contare *quelli che si vedono davvero* servirebbe caricare le due
		// date di ogni conflitto e passarle dal serializzatore.
		conflittiDaTrattare: await haConflittiDaTrattare(db, viewer)
	};
};
