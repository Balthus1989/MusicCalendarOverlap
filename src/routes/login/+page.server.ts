import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { safeNext } from '$lib/server/auth/redirect';
import type { Actions, PageServerLoad } from './$types';

const loginSchema = z.object({
	email: z.email('Indirizzo email non valido.')
});

export const load: PageServerLoad = async ({ url }) => {
	return {
		next: safeNext(url.searchParams.get('next')),
		linkError: url.searchParams.get('error') === 'link-non-valido'
	};
};

/**
 * Messaggio da mostrare quando Supabase rifiuta l'invio.
 *
 * Il caso "questo indirizzo non ha un account" resta deliberatamente
 * indistinguibile da un guasto generico: dire "non ci sei" a chi prova un
 * indirizzo a caso permetterebbe di scoprire, uno per uno, chi è iscritto al
 * calendario. Con la registrazione su invito (ADR-0004) l'elenco degli
 * iscritti è di fatto l'elenco degli organizzatori della zona, e non è nostro
 * da rivelare.
 *
 * Il limite di invii è un'altra cosa: parla di quante richieste ha fatto chi
 * sta guardando lo schermo, non dell'esistenza di un account. Distinguerlo non
 * rivela niente, e risparmia a chi aspetta un'email che non arriverà di
 * concludere che il suo accesso è stato revocato.
 */
function messaggioPerErrore(error: { status?: number; code?: string; message: string }): string {
	const limitato =
		error.status === 429 ||
		error.code === 'over_email_send_rate_limit' ||
		/rate limit|only request this after/i.test(error.message);

	if (limitato) {
		return 'Hai chiesto troppi link in poco tempo e il servizio di posta ha messo in pausa gli invii. Aspetta qualche minuto e riprova: non devi rifare nulla.';
	}

	return 'Non è stato possibile inviare il link. Se non hai ancora un account, ti serve un invito.';
}

export const actions: Actions = {
	default: async ({ request, url, locals }) => {
		const form = await request.formData();
		const parsed = loginSchema.safeParse({ email: form.get('email') });

		if (!parsed.success) {
			return fail(400, {
				email: String(form.get('email') ?? ''),
				error: parsed.error.issues[0]?.message ?? 'Dati non validi.'
			});
		}

		const next = safeNext(String(form.get('next') ?? ''));
		const redirectTo = `${url.origin}/auth/callback?next=${encodeURIComponent(next)}`;

		const { error } = await locals.supabase.auth.signInWithOtp({
			email: parsed.data.email,
			options: {
				emailRedirectTo: redirectTo,
				// ADR-0004: registrazione solo su invito. Un magic link non crea
				// mai un utente nuovo: quello passa da /invite/[code] (Fase 1).
				shouldCreateUser: false
			}
		});

		if (error) {
			// Il messaggio vero non arriva mai all'utente (vedi sotto), quindi
			// senza questa riga un errore di invio è indistinguibile da un
			// account inesistente anche per chi ha il terminale davanti.
			console.error(
				'Invio del magic link non riuscito:',
				JSON.stringify({ status: error.status, code: error.code, message: error.message })
			);

			return fail(400, { email: parsed.data.email, error: messaggioPerErrore(error) });
		}

		return { sent: true, email: parsed.data.email };
	}
};
