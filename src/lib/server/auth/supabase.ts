/**
 * I due client Supabase che non sono `locals.supabase`.
 *
 * `locals.supabase` (`createServerClient` di `@supabase/ssr`) sa scrivere i
 * cookie di sessione ed è quello che **verifica** un token. Non è però quello
 * che deve **spedire** un'email, per una ragione che è costata un pomeriggio e
 * che vale la pena tenere scritta accanto al codice.
 */
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function urlProgetto(): string {
	const url = publicEnv.PUBLIC_SUPABASE_URL;
	if (!url) throw new Error('PUBLIC_SUPABASE_URL mancante. Copia .env.example in .env.');
	return url;
}

/**
 * Client dedicato al solo invio di email di autenticazione, **senza PKCE**.
 *
 * `createServerClient` impone `flowType: 'pkce'` sovrascrivendo l'opzione
 * passata: non è configurabile. Con PKCE attivo Supabase emette token
 * `pkce_…`, e un token così non si verifica con una chiamata sola —
 * `verifyOtp` deve completare uno scambio che pretende il verificatore
 * custodito nel browser che ha *richiesto* il link. Per un link dentro
 * un'email quel presupposto non regge: si apre dal telefono, dalla webmail,
 * dal browser predefinito invece che da quello in uso.
 *
 * Qui PKCE non protegge niente. Non c'è nessun client pubblico: la richiesta
 * parte dal server, il token torna al server, la sessione la scrive il server
 * nei cookie. Quindi l'invio passa da un client normale in flusso implicito,
 * che fa emettere a Supabase un hash semplice.
 *
 * `persistSession: false`: questo client non deve conservare nessuna sessione,
 * manda solo un'email.
 */
export function clientPerInvio(): SupabaseClient {
	const anonKey = publicEnv.PUBLIC_SUPABASE_ANON_KEY;
	if (!anonKey) {
		throw new Error('PUBLIC_SUPABASE_ANON_KEY mancante. Copia .env.example in .env.');
	}

	return createClient(urlProgetto(), anonKey, {
		auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false }
	});
}

/**
 * Client con il ruolo di servizio, per le operazioni di `auth.admin`.
 *
 * **Restituisce `null` se la chiave non c'è**, invece di sollevare. In locale
 * la `SUPABASE_SERVICE_ROLE_KEY` spesso manca, e la conseguenza dev'essere che
 * l'invito si genera lo stesso e si passa a mano — non che la pagina degli
 * inviti smetta di funzionare. È il principio 5 di ARCHITECTURE.md §2: se un
 * servizio accessorio non risponde, la strada manuale resta aperta.
 *
 * Questa chiave scavalca RLS e apre l'intero database: non esce mai dal
 * server, e non entra in nessun modulo che il browser possa importare.
 */
export function clientAmministrativo(): SupabaseClient | null {
	const chiave = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
	if (!chiave) return null;

	return createClient(urlProgetto(), chiave, {
		auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false }
	});
}
