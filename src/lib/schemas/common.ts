/**
 * Mattoni Zod riusati da tutti gli schemi. Una definizione sola per client,
 * server e tipi (ADR-0001).
 */
import { z } from 'zod';

/** Campo di testo opzionale: la stringa vuota di un form vale `null`. */
export const testoOpzionale = (max = 500) =>
	z
		.string()
		.trim()
		.max(max, `Massimo ${max} caratteri.`)
		.transform((v) => (v === '' ? null : v))
		.nullable()
		.default(null);

export const urlOpzionale = z
	.string()
	.trim()
	.transform((v) => (v === '' ? null : v))
	.nullable()
	.default(null)
	.refine(
		(v) => v === null || /^https?:\/\/.+/i.test(v),
		'Deve essere un indirizzo completo, che inizia con http:// o https://'
	);

export const emailOpzionale = z
	.string()
	.trim()
	.transform((v) => (v === '' ? null : v))
	.nullable()
	.default(null)
	.refine((v) => v === null || z.email().safeParse(v).success, 'Indirizzo email non valido.');

/** Sigla di provincia italiana: due lettere. */
export const provinciaOpzionale = z
	.string()
	.trim()
	.toUpperCase()
	.transform((v) => (v === '' ? null : v))
	.nullable()
	.default(null)
	.refine((v) => v === null || /^[A-Z]{2}$/.test(v), 'La provincia è la sigla di due lettere.');

export const latitudine = z
	.number({ message: 'Latitudine mancante.' })
	.min(-90, 'Latitudine fuori intervallo.')
	.max(90, 'Latitudine fuori intervallo.');

export const longitudine = z
	.number({ message: 'Longitudine mancante.' })
	.min(-180, 'Longitudine fuori intervallo.')
	.max(180, 'Longitudine fuori intervallo.');

/** Codice ISO a due lettere; default Italia. */
export const paese = z
	.string()
	.trim()
	.toUpperCase()
	.length(2, 'Il paese è il codice ISO di due lettere.')
	.default('IT');

/** UUID opzionale: un `<select>` senza scelta manda la stringa vuota. */
export const uuidOpzionale = z
	.string()
	.trim()
	.transform((v) => (v === '' ? null : v))
	.nullable()
	.default(null)
	.refine((v) => v === null || z.uuid().safeParse(v).success, 'Riferimento non valido.');

/** Intero opzionale: la stringa vuota vale `null`, non zero. */
export const interoOpzionale = (min: number, max: number) =>
	z
		.union([z.string(), z.number(), z.null()])
		// `.optional()` invece di `z.undefined()` nella union: la union dice
		// quali valori sono ammessi, `.optional()` dice che la chiave può non
		// esserci affatto. Zod le tiene distinte, e da un form la chiave manca
		// per davvero — un campo numerico vuoto, un checkbox non spuntato.
		.optional()
		.transform((v) => {
			if (v === null || v === undefined) return null;
			const s = String(v).trim();
			if (s === '') return null;
			const n = Number(s);
			return Number.isFinite(n) ? Math.trunc(n) : Number.NaN;
		})
		.refine((v) => v === null || (!Number.isNaN(v) && v >= min && v <= max), {
			message: `Deve essere un numero intero fra ${min} e ${max}.`
		});

/** Coordinata opzionale: senza venue un evento può non averle ancora. */
export const coordinataOpzionale = (limite: number) =>
	z
		.union([z.string(), z.number(), z.null()])
		.optional()
		.transform((v) => {
			if (v === null || v === undefined) return null;
			const s = String(v).trim();
			if (s === '') return null;
			const n = Number(s);
			return Number.isFinite(n) ? n : Number.NaN;
		})
		.refine((v) => v === null || (!Number.isNaN(v) && Math.abs(v) <= limite), {
			message: 'Coordinata fuori intervallo.'
		});

/**
 * Prezzo in euro, come stringa `numeric(8,2)`.
 *
 * Accetta la virgola: in Italia si scrive `12,50`, e rifiutarlo sarebbe
 * pedanteria travestita da validazione.
 */
export const prezzoOpzionale = z
	.union([z.string(), z.number(), z.null()])
	.optional()
	.transform((v) => {
		if (v === null || v === undefined) return null;
		const s = String(v).trim().replace(',', '.');
		if (s === '') return null;
		const n = Number(s);
		if (!Number.isFinite(n)) return Number.NaN as unknown as string;
		return n.toFixed(2);
	})
	.refine(
		(v) => v === null || (typeof v === 'string' && Number(v) >= 0 && Number(v) < 1000000),
		'Prezzo non valido.'
	);

/** Vero per i valori che un checkbox HTML manda quando è spuntato. */
export const booleanoDaForm = z
	.union([z.string(), z.boolean(), z.null()])
	.optional()
	.transform((v) => v === true || v === 'on' || v === 'true' || v === '1');

/** Orario di parete `YYYY-MM-DDTHH:MM`, come lo scrive un `datetime-local`. */
const FORMATO_LOCALE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

export const orarioLocale = z
	.string()
	.trim()
	.regex(FORMATO_LOCALE, 'Data e ora non valide.')
	.transform((v) => v.slice(0, 16));

export const orarioLocaleOpzionale = z
	.string()
	.trim()
	.transform((v) => (v === '' ? null : v.slice(0, 16)))
	.nullable()
	.default(null)
	.refine((v) => v === null || FORMATO_LOCALE.test(v), 'Data e ora non valide.');

/** Giorno `YYYY-MM-DD`, per le giornate dei festival. */
export const giornoOpzionale = z
	.string()
	.trim()
	.transform((v) => (v === '' ? null : v))
	.nullable()
	.default(null)
	.refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Data non valida.');
