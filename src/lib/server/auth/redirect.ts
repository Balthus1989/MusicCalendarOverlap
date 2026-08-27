/**
 * Normalizzazione del parametro `?next=` usato dal flusso di login.
 *
 * Il valore arriva da un URL e finisce in una `Location`: se accettasse un URL
 * assoluto diventerebbe un open redirect, cioè un modo per far atterrare su un
 * sito ostile qualcuno che ha appena cliccato un link di accesso legittimo.
 * Si ammettono solo path relativi alla radice.
 */
export const DEFAULT_NEXT = '/calendar';

export function safeNext(raw: string | null | undefined): string {
	if (!raw) return DEFAULT_NEXT;

	// `//host` e `/\host` sono protocol-relative: il browser li tratta come
	// assoluti pur iniziando con uno slash.
	if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
		return DEFAULT_NEXT;
	}

	// Un `\` iniziale viene normalizzato in `/` da alcuni browser.
	if (raw.includes('\\')) return DEFAULT_NEXT;

	// Niente URL assoluti mascherati da path.
	if (/^\/[a-z][a-z0-9+.-]*:/i.test(raw)) return DEFAULT_NEXT;

	return raw;
}

/**
 * Dove atterra chi ha appena convertito un link di accesso in una sessione.
 *
 * Funzione pura: la decisione si prova caso per caso, l'I/O che la alimenta
 * sta nel callback.
 *
 * Il `next` nell'URL **non è più la strada principale**, ed è il motivo per
 * cui esiste questa funzione. Il parametro non sopravvive al template email:
 * `{{ .RedirectTo }}` torna intero e il template gli appende il proprio `?`,
 * quindi un indirizzo di ritorno con una query produce un link con due punti
 * interrogativi e il `token_hash` finisce dentro il valore di `next`. Da qui
 * la regola: l'indirizzo di ritorno si passa **nudo**, e la destinazione
 * viaggia nel token, cioè in `user_metadata`.
 *
 * `haMembership` è ciò che rende la regola auto-limitante: il codice resta nei
 * metadati anche dopo essere stato riscattato — un invito con più utilizzi
 * resta valido — ma chi è già dentro un'organizzazione non ha più niente da
 * accettare, e va al calendario come chiunque altro.
 */
export function destinazioneDopoAccesso(atterraggio: {
	next: string | null | undefined;
	codiceInvito: string | null | undefined;
	haMembership: boolean;
}): string {
	const next = safeNext(atterraggio.next);
	if (next !== DEFAULT_NEXT) return next;

	const codice = atterraggio.codiceInvito?.trim();
	if (codice && !atterraggio.haMembership) {
		return `/invite/${encodeURIComponent(codice)}`;
	}

	return DEFAULT_NEXT;
}
