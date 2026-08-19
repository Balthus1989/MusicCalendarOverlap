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
