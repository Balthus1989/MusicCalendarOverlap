/**
 * Costruzione del `ViewerContext` a partire dalla sessione Supabase.
 *
 * Il profilo è lo specchio applicativo di `auth.users`: viene creato al primo
 * accesso e poi riusato. L'operazione è idempotente.
 */
import type { User } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';
import type { Database } from '$lib/server/db/client';
import { profiles, type Profile } from '$lib/server/db/schema';
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

export function toViewerContext(profile: Profile, organizationIds: string[]): ViewerContext {
	return {
		profileId: profile.id,
		organizationIds,
		isPlatformAdmin: profile.isPlatformAdmin
	};
}
