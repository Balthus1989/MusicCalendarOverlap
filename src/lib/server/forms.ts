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

/**
 * Raccoglie le righe di un sotto-form ripetuto, nominate `prefisso.N.campo`.
 *
 * La lineup è dinamica: righe aggiunte, riordinate, tolte. Con i nomi
 * indicizzati il form resta un form HTML normale — niente JSON in un campo
 * nascosto, che smetterebbe di funzionare appena JavaScript non parte.
 *
 * Gli indici possono avere buchi (l'utente ha rimosso la riga 1 di 3): si
 * ordina per indice e si ricompatta, così `position` finisce per essere
 * l'ordine di locandina che si vede a schermo.
 */
export function righeIndicizzate(form: FormData, prefisso: string): Record<string, string>[] {
	const perIndice = new Map<number, Record<string, string>>();

	for (const [chiave, valore] of form.entries()) {
		if (typeof valore !== 'string') continue;
		if (!chiave.startsWith(`${prefisso}.`)) continue;

		const resto = chiave.slice(prefisso.length + 1);
		const punto = resto.indexOf('.');
		if (punto < 0) continue;

		const indice = Number(resto.slice(0, punto));
		if (!Number.isInteger(indice)) continue;

		const campo = resto.slice(punto + 1);
		const riga = perIndice.get(indice) ?? {};
		riga[campo] = valore;
		perIndice.set(indice, riga);
	}

	return [...perIndice.entries()].sort((a, b) => a[0] - b[0]).map(([, riga]) => riga);
}

/** Tutti i valori di un campo ripetuto (checkbox multipli, `<select multiple>`). */
export function valoriMultipli(form: FormData, nome: string): string[] {
	return form.getAll(nome).filter((v): v is string => typeof v === 'string' && v !== '');
}
