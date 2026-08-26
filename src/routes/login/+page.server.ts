import { env as publicEnv } from '$env/dynamic/public';
import { createClient } from '@supabase/supabase-js';
import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { safeNext } from '$lib/server/auth/redirect';
import type { Actions, PageServerLoad } from './$types';

const loginSchema = z.object({
	email: z.email('Indirizzo email non valido.')
});

/**
 * Client dedicato al solo invio del magic link, **senza PKCE**.
 *
 * `createServerClient` di `@supabase/ssr` impone `flowType: 'pkce'`
 * sovrascrivendo l'opzione passata: non è configurabile. Con PKCE attivo
 * Supabase emette token `pkce_…`, e un token così non si verifica con una
 * chiamata sola — `verifyOtp` deve completare uno scambio che pretende il
 * verificatore custodito nel browser che ha *richiesto* il link. Per un link
 * dentro un'email quel presupposto non regge: si apre dal telefono, dalla
 * webmail, dal browser predefinito invece che da quello in uso.
 *
 * Qui PKCE non protegge niente. Non c'è nessun client pubblico: la richiesta
 * parte dal server, il token torna al server, la sessione la scrive il server
 * nei cookie. Quindi l'invio passa da un client normale in flusso implicito,
 * che fa emettere a Supabase un hash semplice.
 *
 * La **verifica** resta a `locals.supabase`, cioè al client SSR: è quello che
 * sa scrivere i cookie di sessione. Un hash semplice `verifyOtp` lo risolve in
 * una chiamata, senza aver bisogno di niente che stia nel browser.
 *
 * `persistSession: false`: questo client non deve conservare nessuna sessione,
 * manda solo un'email.
 */
function clientPerInvio() {
	const url = publicEnv.PUBLIC_SUPABASE_URL;
	const anonKey = publicEnv.PUBLIC_SUPABASE_ANON_KEY;

	if (!url || !anonKey) {
		throw new Error(
			'PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY mancanti. Copia .env.example in .env.'
		);
	}

	return createClient(url, anonKey, {
		auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false }
	});
}

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
	default: async ({ request, url }) => {
		const form = await request.formData();
		const parsed = loginSchema.safeParse({ email: form.get('email') });

		if (!parsed.success) {
			return fail(400, {
				email: String(form.get('email') ?? ''),
				error: parsed.error.issues[0]?.message ?? 'Dati non validi.'
			});
		}

		/**
		 * L'indirizzo di ritorno finisce nel template email come
		 * `{{ .RedirectTo }}`, e il template gli appende
		 * `?token_hash=…&type=magiclink`.
		 *
		 * **Va passato nudo, senza query string.** Qui c'era un `?next=…`, sulla
		 * convinzione — scritta anche nel README — che Supabase scartasse la
		 * query e rendesse solo il percorso della allow-list. Non è così:
		 * `redirect_to` torna **intero**, il template ci appende il suo `?`, e
		 * il link che arriva nella posta ha due punti interrogativi:
		 *
		 *     /auth/callback?next=%2Fcalendar?token_hash=…&type=magiclink
		 *
		 * Un URL ne ammette uno solo. Tutto ciò che segue il primo diventa
		 * query, quindi `token_hash` finisce **dentro il valore di `next`** e al
		 * callback non arriva: il login falliva con "nessun parametro
		 * utilizzabile" su ogni link, anche appena ricevuto.
		 *
		 * Il `?` del template resta giusto **perché** questo indirizzo è nudo.
		 * Con un `&` si otterrebbe `/auth/callback&token_hash=…`, un percorso
		 * solo, e un 404.
		 *
		 * La destinazione dopo l'accesso la decide quindi `safeNext(null)`, cioè
		 * `/calendar`: nel flusso via email non c'è modo di portarsi dietro un
		 * `next`, ed è una perdita accettabile — chi arriva da un magic link non
		 * stava andando da nessuna parte in particolare.
		 *
		 * Si costruisce da `url.origin`, quindi lo stesso template vale in
		 * locale e in produzione senza toccare niente nel pannello.
		 */
		const redirectTo = `${url.origin}/auth/callback`;

		const { error } = await clientPerInvio().auth.signInWithOtp({
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
