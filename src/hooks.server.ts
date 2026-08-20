/**
 * Catena di hook server (ADR-0003).
 *
 * `supabaseHandle` costruisce il client di auth per la richiesta. È l'unico
 * punto in cui Supabase viene usato: i dati di dominio passano da Drizzle.
 * `authGuard` protegge il gruppo di rotte `(app)`.
 */
import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { createServerClient } from '@supabase/ssr';
import { redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { loadViewer } from '$lib/server/auth/viewer';
import { getDb } from '$lib/server/db/client';

/**
 * Il confine di autenticazione è il **gruppo di rotte** `(app)`, non una lista
 * di path. Una lista va tenuta aggiornata a mano e prima o poi qualcuno
 * aggiunge una rotta dimenticandosene: qui invece basta creare il file dentro
 * `src/routes/(app)/` perché sia protetto.
 */
const PROTECTED_GROUP = '/(app)';

const supabaseHandle: Handle = async ({ event, resolve }) => {
	const url = publicEnv.PUBLIC_SUPABASE_URL;
	const anonKey = publicEnv.PUBLIC_SUPABASE_ANON_KEY;

	if (!url || !anonKey) {
		throw new Error(
			'PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY mancanti. Copia .env.example in .env.'
		);
	}

	event.locals.supabase = createServerClient(url, anonKey, {
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (cookiesToSet) => {
				for (const { name, value, options } of cookiesToSet) {
					event.cookies.set(name, value, { ...options, path: '/' });
				}
			}
		}
	});

	/**
	 * `getSession()` da solo non è affidabile: il JWT nel cookie non è
	 * verificato. Si valida sempre con `getUser()`, che interroga il server.
	 */
	event.locals.safeGetSession = async () => {
		const {
			data: { session }
		} = await event.locals.supabase.auth.getSession();
		if (!session) return { session: null, user: null };

		const {
			data: { user },
			error
		} = await event.locals.supabase.auth.getUser();
		if (error) return { session: null, user: null };

		return { session, user };
	};

	return resolve(event, {
		filterSerializedResponseHeaders: (name) =>
			name === 'content-range' || name === 'x-supabase-api-version'
	});
};

const authGuard: Handle = async ({ event, resolve }) => {
	const { session, user } = await event.locals.safeGetSession();
	event.locals.session = session;
	event.locals.user = user;
	event.locals.viewer = null;
	event.locals.profile = null;

	const isProtected = event.route.id?.startsWith(PROTECTED_GROUP) ?? false;

	if (isProtected && !session) {
		const next = encodeURIComponent(event.url.pathname + event.url.search);
		redirect(303, `/login?next=${next}`);
	}

	if (event.route.id === '/login' && session) {
		redirect(303, '/calendar');
	}

	/**
	 * Il viewer si costruisce **qui**, non nella `load` del layout.
	 *
	 * In SvelteKit le form action girano *prima* delle `load`: un contesto
	 * popolato in una `load` non esiste ancora quando l'action lo legge, e
	 * ogni scrittura fallirebbe con "Sessione non valida". Gli hook sono
	 * l'unico punto attraversato da entrambe.
	 */
	if (user && (isProtected || event.route.id?.startsWith('/api/'))) {
		const { profile, viewer } = await loadViewer(getDb(), user);
		event.locals.profile = profile;
		event.locals.viewer = viewer;
	}

	return resolve(event);
};

/** Endpoint cron protetti da header segreto (ARCHITECTURE.md §7, ADR-0013). */
const cronGuard: Handle = async ({ event, resolve }) => {
	if (event.url.pathname.startsWith('/api/cron/')) {
		const expected = privateEnv.CRON_SECRET;
		const provided = event.request.headers.get('x-cron-secret');
		if (!expected || provided !== expected) {
			return new Response('Forbidden', { status: 403 });
		}
	}
	return resolve(event);
};

export const handle = sequence(supabaseHandle, authGuard, cronGuard);
