// See https://svelte.dev/docs/kit/types#app.d.ts
import type { SupabaseClient, Session, User } from '@supabase/supabase-js';
import type { ViewerContext } from '$lib/server/visibility';

declare global {
	namespace App {
		interface Locals {
			/** Client Supabase lato server: usato **solo** per l'auth (ADR-0003). */
			supabase: SupabaseClient;
			/**
			 * Valida la sessione contro il server di auth. Da preferire sempre a
			 * `supabase.auth.getSession()`, il cui payload non è verificato.
			 */
			safeGetSession: () => Promise<{ session: Session | null; user: User | null }>;
			session: Session | null;
			user: User | null;
			/** Popolato solo nelle rotte autenticate, da `(app)/+layout.server.ts`. */
			viewer: ViewerContext | null;
		}
		interface PageData {
			session: Session | null;
		}
		interface Platform {
			env?: Record<string, string>;
		}
	}
}

export {};
