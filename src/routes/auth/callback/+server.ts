/**
 * Atterraggio del magic link.
 *
 * Gestisce entrambe le forme che Supabase può produrre:
 * - `?code=…`        flusso PKCE (template email di default)
 * - `?token_hash=…&type=…`  template email personalizzato con `{{ .TokenHash }}`
 *
 * Tenerle entrambe evita che il login si rompa se il template email viene
 * cambiato dal pannello Supabase.
 */
import { redirect, type RequestHandler } from '@sveltejs/kit';
import type { EmailOtpType } from '@supabase/supabase-js';
import { safeNext } from '$lib/server/auth/redirect';

export const GET: RequestHandler = async ({ url, locals }) => {
	const next = safeNext(url.searchParams.get('next'));
	const code = url.searchParams.get('code');
	const tokenHash = url.searchParams.get('token_hash');
	const type = url.searchParams.get('type') as EmailOtpType | null;

	if (code) {
		const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
		if (!error) redirect(303, next);
	} else if (tokenHash && type) {
		const { error } = await locals.supabase.auth.verifyOtp({ token_hash: tokenHash, type });
		if (!error) redirect(303, next);
	}

	redirect(303, '/login?error=link-non-valido');
};
