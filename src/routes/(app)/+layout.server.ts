import { error } from '@sveltejs/kit';
import { ensureProfile, toViewerContext } from '$lib/server/auth/viewer';
import { getDb } from '$lib/server/db/client';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	// `authGuard` in hooks.server.ts ha già rediretto se la sessione manca.
	if (!locals.user) error(401, 'Sessione non valida.');

	const db = getDb();
	const profile = await ensureProfile(db, locals.user);

	// Fase 1: qui si leggono le `memberships` per popolare `organizationIds`.
	const organizationIds: string[] = [];

	locals.viewer = toViewerContext(profile, organizationIds);

	return {
		viewer: locals.viewer,
		profile: {
			id: profile.id,
			displayName: profile.displayName,
			email: profile.email,
			isPlatformAdmin: profile.isPlatformAdmin
		}
	};
};
