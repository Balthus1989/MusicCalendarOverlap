/**
 * Un `FormData` può contenere `File`, che non è serializzabile verso il client
 * né utile a ripopolare un input di testo. Questo converte tutto in stringhe,
 * così i valori possono tornare al form dopo un errore di validazione.
 */
export function formValues(form: FormData): Record<string, string> {
	return Object.fromEntries(
		[...form.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : ''])
	);
}
