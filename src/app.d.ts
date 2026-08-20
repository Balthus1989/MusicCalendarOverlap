// See https://svelte.dev/docs/kit/types#app.d.ts
import type { SupabaseClient, Session, User } from '@supabase/supabase-js';
import type { ViewerContext } from '$lib/server/visibility';
import type { Profile } from '$lib/server/db/schema';

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
			/**
			 * Popolato da `hooks.server.ts` per le rotte `(app)` e `/api`.
			 * **Non** da una `load`: le form action girano prima delle load e
			 * leggerebbero un contesto ancora vuoto.
			 */
			viewer: ViewerContext | null;
			profile: Profile | null;
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
