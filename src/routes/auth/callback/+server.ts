/**
 * Atterraggio del magic link.
 *
 * Gestisce entrambe le forme che Supabase può produrre:
 * - `?code=…`        flusso PKCE (template email di default)
 * - `?token_hash=…&type=…`  template email personalizzato con `{{ .TokenHash }}`
 *
 * Tenerle entrambe evita che il login si rompa se il template email viene
 * cambiato dal pannello Supabase.
 *
 * **Dove si atterra non lo decide più l'URL.** Il `?next=` non sopravvive al
 * template — vedi `destinazioneDopoAccesso()` — quindi la destinazione viaggia
 * nei `user_metadata`: chi arriva da un invito ha lì il codice, e va alla
 * pagina che deve accettare (ADR-0045).
 */
import { redirect, type RequestHandler } from '@sveltejs/kit';
import type { EmailOtpType, User } from '@supabase/supabase-js';
import { destinazioneDopoAccesso } from '$lib/server/auth/redirect';
import { getDb } from '$lib/server/db/client';
import { lookupInvite } from '$lib/server/invites/service';
import { memberships } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

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

/**
 * Il codice di invito lasciato nei metadati da `invitaPerEmail()`.
 *
 * `user_metadata` è scritto dal ruolo di servizio al momento dell'invito e non
 * è modificabile dall'utente senza una sessione: qui vale solo a scegliere una
 * destinazione, e la validità dell'invito la ricontrolla `/invite/[code]` come
 * per chiunque arrivi da un link passato a mano.
 */
function codiceInvitoDi(user: User | null | undefined): string | null {
	const valore = user?.user_metadata?.codice_invito;
	return typeof valore === 'string' && valore.trim() ? valore.trim() : null;
}

export const GET: RequestHandler = async ({ url, locals }) => {
	const code = url.searchParams.get('code');
	const tokenHash = url.searchParams.get('token_hash');
	const type = url.searchParams.get('type') as EmailOtpType | null;

	let entrato = false;

	if (code) {
		const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
		if (error) registraFallimento('code', url, error);
		else entrato = true;
	} else if (tokenHash && type) {
		const { error } = await locals.supabase.auth.verifyOtp({ token_hash: tokenHash, type });
		if (error) registraFallimento('token_hash', url, error);
		else entrato = true;
	} else {
		registraFallimento('nessun parametro utilizzabile', url, null);
	}

	// `/login` non crea utenti (ADR-0004), quindi per un invitato è una porta
	// che non si aprirà. Non c'è modo di riconoscerlo qui â l'indirizzo di
	// ritorno è nudo per forza e senza sessione non ci sono metadati da
	// leggere â quindi è la pagina di login a dire anche a lui che cosa fare.
	if (!entrato) redirect(303, '/login?error=link-non-valido');

	const { user } = await locals.safeGetSession();
	const codiceInvito = codiceInvitoDi(user);

	// Le due query si fanno solo se c'è un invito da seguire: per tutti gli
	// altri la destinazione è già decisa e non valgono un viaggio al database.
	let haMembership = false;
	let invitoUtilizzabile = false;
	if (codiceInvito && user) {
		const db = getDb();
		const righe = await db
			.select({ id: memberships.id })
			.from(memberships)
			.where(eq(memberships.profileId, user.id))
			.limit(1);
		haMembership = righe.length > 0;

		// Il codice nei metadati può essere vecchio, e mandare qualcuno su un
		// invito revocato un istante dopo averlo fatto entrare è il modo
		// peggiore di accoglierlo. Vedi `destinazioneDopoAccesso()`.
		if (!haMembership) {
			invitoUtilizzabile = (await lookupInvite(db, codiceInvito)).ok;
		}
	}

	redirect(
		303,
		destinazioneDopoAccesso({
			next: url.searchParams.get('next'),
			codiceInvito,
			haMembership,
			invitoUtilizzabile
		})
	);
};
