/**
 * Token dei feed ICS (ARCHITECTURE.md §8, ADR-0011).
 *
 * Un token è l'unica cosa che protegge il feed: l'endpoint che lo serve è
 * pubblico, perché nessun client calendario sa fare login. Quindi va generato
 * con un CSPRNG e va lungo — non si detta al telefono come un codice di
 * invito, si incolla, e non c'è nessun motivo di risparmiare caratteri.
 */

/** Ventiquattro byte casuali diventano esattamente 32 caratteri base64url. */
const BYTE = 24;
export const LUNGHEZZA_TOKEN = 32;

/**
 * Alfabeto URL-safe: `-` e `_` al posto di `+` e `/`, nessun `=` di padding.
 * Un token finisce dentro un URL che l'utente incolla in Google Calendar, e
 * un `+` percent-encodato male è il genere di guasto che si scopre tardi.
 */
function base64url(bytes: Uint8Array): string {
	let binario = '';
	for (const b of bytes) binario += String.fromCharCode(b);
	return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generaTokenFeed(): string {
	const bytes = new Uint8Array(BYTE);
	crypto.getRandomValues(bytes);
	return base64url(bytes);
}

/**
 * Vero se la stringa ha la forma di un token.
 *
 * Serve solo a evitare una query per ogni URL malformato che passa di lì: non
 * è un controllo di sicurezza, e non deve diventarlo.
 */
export function tokenBenFormato(raw: string): boolean {
	return raw.length === LUNGHEZZA_TOKEN && /^[A-Za-z0-9_-]+$/.test(raw);
}
