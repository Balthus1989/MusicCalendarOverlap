/**
 * Normalizzazione testuale condivisa. Codice puro, testato: da qui dipendono
 * la deduplica degli artisti (ADR-0006), gli slug delle organizzazioni e la
 * chiave della cache di geocoding.
 */

/**
 * Forma canonica di un nome, per confronto e deduplica.
 *
 * Toglie accenti, punteggiatura e differenze di spaziatura, così che
 * "Nero Sabbia", "nero  sabbia" e "Neró-Sabbia!" collassino sullo stesso
 * valore. Non tocca il nome mostrato: quello resta come l'ha scritto chi
 * l'ha inserito.
 */
export function normalizeName(input: string): string {
	return (
		input
			.normalize('NFD')
			// Blocco dei segni diacritici combinanti.
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			// La ß non ha una decomposizione NFD: va espansa a mano.
			.replace(/ß/g, 'ss')
			// Apostrofi e trattini uniscono, non separano: "d'Amore" e "dAmore"
			// sono lo stesso nome, "Sun-Ra" e "Sun Ra" no.
			.replace(/['’`]/g, '')
			.replace(/[^a-z0-9]+/g, ' ')
			.trim()
			.replace(/\s+/g, ' ')
	);
}

/** Slug URL-safe, per le organizzazioni e la tassonomia generi. */
export function slugify(input: string): string {
	return normalizeName(input).replace(/ /g, '-');
}

/**
 * Chiave della cache di geocoding. Più aggressiva di `normalizeName`: qui
 * l'obiettivo è far collidere query equivalenti, non distinguere entità.
 */
export function normalizeGeocodeQuery(input: string): string {
	return (
		normalizeName(input)
			.replace(/\b(via|viale|piazza|piazzale|corso|largo)\b/g, '')
			// La rimozione lascia spazi doppi e bordi sporchi: se non si ricollassa,
			// due query equivalenti generano due chiavi di cache diverse e la cache
			// smette di funzionare senza dare segno.
			.replace(/\s+/g, ' ')
			.trim()
	);
}

/**
 * Vero se due nomi sono abbastanza simili da meritare un avviso di possibile
 * doppione. Distanza di Levenshtein normalizzata sulla lunghezza.
 */
export function looksLikeDuplicate(a: string, b: string, soglia = 0.14): boolean {
	const x = normalizeName(a);
	const y = normalizeName(b);
	if (!x || !y) return false;
	if (x === y) return true;

	const maxLen = Math.max(x.length, y.length);
	// Su nomi cortissimi ogni refuso supera qualunque soglia relativa:
	// meglio non avvisare che avvisare sempre.
	if (maxLen < 5) return false;

	return levenshtein(x, y) / maxLen <= soglia;
}

/** Distanza di edit, implementazione a due righe di buffer. */
export function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (!a.length) return b.length;
	if (!b.length) return a.length;

	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	let curr = new Array<number>(b.length + 1);

	for (let i = 1; i <= a.length; i++) {
		curr[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const costo = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + costo);
		}
		[prev, curr] = [curr, prev];
	}

	return prev[b.length];
}
