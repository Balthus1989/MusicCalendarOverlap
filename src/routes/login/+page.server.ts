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
			return fail(400, {
				email: parsed.data.email,
				error:
					'Non è stato possibile inviare il link. Se non hai ancora un account, ti serve un invito.'
			});
		}

		return { sent: true, email: parsed.data.email };
	}
};
