/**
 * Schema del form di segnalazione (ADR-0044).
 *
 * Una segnalazione riguarda la data di un organizzatore che nel calendario non
 * è iscritto. Chi la compila **non è chi la organizza**, e questo schema è il
 * posto in cui quel fatto è scritto in modo che non si possa aggirare per
 * distrazione: è deliberatamente molto più corto di `eventSchema`, e i campi
 * che mancano mancano per una ragione, non per fretta.
 *
 * Tre cose non ci sono, per lo stesso criterio di [ADR-0031](../../../docs/DECISIONS.md)
 * — *si riempie ciò che chi compila può sapere; non si tocca ciò che non è suo*:
 *
 * 1. **`status`.** Non esiste. Una data esterna nasce `confirmed` e non può
 *    essere altro: chi segnala l'ha letta da qualche parte, quindi è già
 *    pubblica, e `draft`/`hold` proteggono un annuncio che qui nessuno deve
 *    ancora fare. Lo `CHECK` sullo schema del database dice la stessa cosa.
 * 2. **`isAnnounced` sulla lineup.** Non è una scelta da offrire: la serata è
 *    pubblica per costruzione, e `versoEvento` lo scrive una volta sola con la
 *    sua motivazione. Un interruttore qui suggerirebbe che ci sia qualcosa da
 *    tenere nascosto su una data che nessuno di noi organizza.
 * 3. **`artistId`.** La lineup resta testo libero. Collegare la scheda di
 *    un'omonima è l'errore che non si vede rileggendo il form, e il motore
 *    conflitti confronta gli id, non i nomi.
 *
 * Non c'è nemmeno `internalNotes`: le note interne sono di un'organizzazione,
 * e qui l'organizzazione proprietaria non ha membri che possano leggerle.
 */
import { z } from 'zod';
import {
	orarioLocale,
	orarioLocaleOpzionale,
	provinciaOpzionale,
	testoOpzionale,
	urlOpzionale,
	uuidOpzionale
} from './common';

export const segnalazioneSchema = z
	.object({
		/**
		 * L'organizzazione **del segnalante**, fra quelle di cui è membro: è la
		 * firma che l'avviso porta in calendario, non un dato accessorio.
		 */
		segnalataDaOrganizationId: z.uuid('Scegli con quale organizzazione segnali.'),

		/**
		 * Il nome dell'organizzatore esterno. È testo libero perché è tutto ciò
		 * che chi segnala può sapere: la deduplica avviene al salvataggio, sul
		 * nome normalizzato, come per artisti e venue (ADR-0006).
		 */
		organizzatore: z
			.string()
			.trim()
			.min(2, 'Serve il nome di chi organizza la serata.')
			.max(200, 'Massimo 200 caratteri.'),

		title: z.string().trim().min(2, 'Il titolo è obbligatorio.').max(200),

		/* Luogo. La città è obbligatoria: senza, la data resta fuori da tutte
		   le regole geografiche del motore e la segnalazione non serve a nulla
		   (ADR-0025). */
		venueId: uuidOpzionale,
		city: z.string().trim().min(2, 'La città è obbligatoria.').max(120),
		province: provinciaOpzionale,

		startsAtLocal: orarioLocale,
		endsAtLocal: orarioLocaleOpzionale,

		/** Il genere principale alimenta la regola di affinità (R3). */
		primaryGenreSlug: testoOpzionale(80),

		/** Nomi delle band, uno per riga. Restano testo: vedi il punto 3 sopra. */
		lineup: z
			.array(z.string().trim().min(1).max(200))
			.max(60, 'Sessanta nomi sono già più di una segnalazione.')
			.default([]),

		/**
		 * Da dove viene la notizia: il post, l'evento, la locandina online.
		 * Non è obbligatorio — a volte lo si sa e basta — ma è la cosa che
		 * rende una segnalazione verificabile da chi la legge.
		 */
		fonteUrl: urlOpzionale,

		note: testoOpzionale(1000)
	})
	.superRefine((v, ctx) => {
		if (v.endsAtLocal && v.endsAtLocal <= v.startsAtLocal) {
			ctx.addIssue({
				code: 'custom',
				path: ['endsAtLocal'],
				message: 'La fine deve venire dopo l’inizio.'
			});
		}
	});

export type SegnalazioneInput = z.infer<typeof segnalazioneSchema>;
