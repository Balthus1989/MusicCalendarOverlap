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
