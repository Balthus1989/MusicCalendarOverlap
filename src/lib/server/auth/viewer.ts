/**
 * Costruzione del `ViewerContext` a partire dalla sessione Supabase.
 *
 * Il profilo è lo specchio applicativo di `auth.users`: viene creato al primo
 * accesso e poi riusato. L'operazione è idempotente.
 */
import type { User } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';
import type { Database } from '$lib/server/db/client';
import { memberships, profiles, type MemberRole, type Profile } from '$lib/server/db/schema';
import type { ViewerContext } from '$lib/server/visibility';

function displayNameFor(user: User): string {
	const meta = user.user_metadata ?? {};
	const candidate = meta.display_name ?? meta.full_name ?? meta.name;
	if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
	return user.email?.split('@')[0] ?? 'Organizzatore';
}

/** Restituisce il profilo dell'utente, creandolo se è il primo accesso. */
export async function ensureProfile(db: Database, user: User): Promise<Profile> {
	const existing = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);
	if (existing[0]) return existing[0];

	const inserted = await db
		.insert(profiles)
		.values({
			id: user.id,
			email: user.email ?? '',
			displayName: displayNameFor(user)
		})
		.onConflictDoNothing({ target: profiles.id })
		.returning();

	if (inserted[0]) return inserted[0];

	// Race con un'altra richiesta dello stesso utente: rileggiamo.
	const reread = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);
	if (!reread[0]) throw new Error(`Impossibile creare il profilo per ${user.id}`);
	return reread[0];
}

/** Ruolo del profilo in ciascuna organizzazione di cui è membro. */
export async function loadRoles(
	db: Database,
	profileId: string
): Promise<Record<string, MemberRole>> {
	const righe = await db
		.select({ organizationId: memberships.organizationId, role: memberships.role })
		.from(memberships)
		.where(eq(memberships.profileId, profileId));

	return Object.fromEntries(righe.map((r) => [r.organizationId, r.role]));
}

export function toViewerContext(
	profile: Profile,
	roles: Record<string, MemberRole>
): ViewerContext {
	return {
		profileId: profile.id,
		organizationIds: Object.keys(roles),
		roles,
		isPlatformAdmin: profile.isPlatformAdmin
	};
}

/** Profilo + ruoli in una sola chiamata: è ciò che serve a ogni rotta `(app)`. */
export async function loadViewer(db: Database, user: User) {
	const profile = await ensureProfile(db, user);
	const roles = await loadRoles(db, profile.id);
	return { profile, viewer: toViewerContext(profile, roles) };
}

/**
 * Il viewer di un profilo che **non ha una sessione in corso**.
 *
 * Serve al feed ICS, che è servito a un client calendario senza login: lì
 * l'identità non arriva da un cookie ma dal token, e il contenuto va redatto
 * come lo vedrebbe il proprietario del feed (ADR-0011). Da qui non si crea
 * nessun profilo: se non esiste, non esiste.
 */
export async function viewerPerProfilo(db: Database, profileId: string) {
	const righe = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
	const profile = righe[0];
	if (!profile) return null;

	const roles = await loadRoles(db, profile.id);
	return { profile, viewer: toViewerContext(profile, roles) };
}
