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

type ErroreSupabase = { status?: number; code?: string; message: string };

/**
 * Perché il link non ha funzionato, nel terminale del server.
 *
 * All'utente si dice sempre e solo "link non valido", ed è giusto così: le
 * differenze fra "scaduto", "già usato" e "verificatore mancante" non lo
 * aiutano e raccontano qualcosa a chi provasse a indovinare. Ma senza questa
 * riga la stessa cosa vale per chi ha il terminale davanti, e le tre cause
 * hanno rimedi completamente diversi:
 *
 * - **codice già consumato** — il link è a uso singolo, e qualcosa lo ha
 *   aperto prima dell'utente. Di solito è un antivirus o lo scanner del
 *   provider di posta che precarica i link;
 * - **verificatore PKCE mancante** — il link è stato aperto in un browser
 *   diverso da quello che l'ha richiesto, oppure il cookie è stato perso;
 * - **né `code` né `token_hash`** — Supabase ha risposto con il flusso
 *   implicito, che mette il token nel frammento dell'URL: il frammento non
 *   arriva mai al server, quindi qui non c'è niente da scambiare.
 *
 * È la stessa scelta già fatta nell'azione di login: messaggio vago fuori,
 * causa esatta nel registro.
 */
function registraFallimento(via: string, url: URL, errore: ErroreSupabase | null) {
	console.error(
		'Magic link non convertito in sessione:',
		JSON.stringify({
			via,
			parametri: [...url.searchParams.keys()],
			status: errore?.status,
			code: errore?.code,
			message: errore?.message
		})
	);
}

export const GET: RequestHandler = async ({ url, locals }) => {
	const next = safeNext(url.searchParams.get('next'));
	const code = url.searchParams.get('code');
	const tokenHash = url.searchParams.get('token_hash');
	const type = url.searchParams.get('type') as EmailOtpType | null;

	if (code) {
		const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
		if (!error) redirect(303, next);
		registraFallimento('code', url, error);
	} else if (tokenHash && type) {
		const { error } = await locals.supabase.auth.verifyOtp({ token_hash: tokenHash, type });
		if (!error) redirect(303, next);
		registraFallimento('token_hash', url, error);
	} else {
		registraFallimento('nessun parametro utilizzabile', url, null);
	}

	redirect(303, '/login?error=link-non-valido');
};
