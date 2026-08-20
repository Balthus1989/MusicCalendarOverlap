/**
 * Schema del form evento (ARCHITECTURE.md §12, Fase 2).
 *
 * È il form più lungo del prodotto: dati base, luogo, orari, ticketing,
 * lineup dinamica, generi, link. Una definizione sola, valida per il client,
 * per il server e per i tipi (ADR-0001).
 *
 * Gli orari viaggiano come **orario di parete** (`2026-10-12T22:00`), cioè
 * esattamente ciò che scrive un `<input type="datetime-local">`. La
 * conversione in istante assoluto avviene in un punto solo, al salvataggio,
 * con `daLocaleAIstante()`: qui non si costruiscono mai `Date`, altrimenti si
 * finirebbe a interpretare l'ora di parete nel fuso del server, che su
 * Cloudflare è UTC.
 */
import { z } from 'zod';
import {
	booleanoDaForm,
	coordinataOpzionale,
	giornoOpzionale,
	interoOpzionale,
	orarioLocale,
	orarioLocaleOpzionale,
	paese,
	prezzoOpzionale,
	provinciaOpzionale,
	testoOpzionale,
	urlOpzionale,
	uuidOpzionale
} from './common';

export const statoEvento = z.enum(['draft', 'hold', 'confirmed', 'cancelled']);

export const ruoloLocandina = z.enum([
	'headliner',
	'co_headliner',
	'special_guest',
	'support',
	'opener',
	'dj',
	'tba'
]);

export { ETICHETTE_LOCANDINA } from '$lib/events';

/**
 * Una riga di lineup.
 *
 * `artistId` collega l'anagrafica condivisa ed è ciò che rende possibile la
 * regola R2 sugli artisti (ADR-0006). `artistName` da solo resta ammesso: una
 * band non ancora in anagrafica, o un "TBA", non devono impedire di salvare
 * la data.
 */
export const vocelineupSchema = z
	.object({
		/** Presente solo per le righe già salvate: serve a non perderne l'identità. */
		id: uuidOpzionale,
		artistId: uuidOpzionale,
		artistName: z
			.string()
			.trim()
			.max(200, 'Massimo 200 caratteri.')
			.transform((v) => (v === '' ? null : v))
			.nullable()
			.default(null),
		billing: ruoloLocandina.default('support'),
		stage: testoOpzionale(80),
		dayDate: giornoOpzionale,
		setStartsAtLocal: orarioLocaleOpzionale,
		setDurationMinutes: interoOpzionale(1, 600).nullable().default(null),
		/** Rivelazione progressiva: finché è falso, la band non esce mai. */
		isAnnounced: booleanoDaForm,
		notes: testoOpzionale(500)
	})
	.refine((v) => v.artistId !== null || v.artistName !== null, {
		message: 'Serve un nome, oppure una band scelta dall’anagrafica.',
		path: ['artistName']
	});

export const linkEventoSchema = z.object({
	label: z.string().trim().min(1, 'Serve un’etichetta.').max(80),
	url: z
		.string()
		.trim()
		.regex(/^https?:\/\/.+/i, 'Deve iniziare con http:// o https://')
		.max(500)
});

export const eventSchema = z
	.object({
		organizationId: z.uuid('Organizzazione non valida.'),
		status: statoEvento.default('draft'),

		/* Dati base */
		title: z.string().trim().min(2, 'Il titolo è obbligatorio.').max(200),
		subtitle: testoOpzionale(200),
		description: testoOpzionale(5000),

		/* Luogo */
		venueId: uuidOpzionale,
		city: z.string().trim().min(2, 'La città è obbligatoria.').max(120),
		province: provinciaOpzionale,
		region: testoOpzionale(120),
		country: paese,
		// Nullable: si copiano dal venue o dal geocoding della città al
		// salvataggio (ADR-0008). Il form non obbliga l'utente a saperle.
		lat: coordinataOpzionale(90).nullable().default(null),
		lon: coordinataOpzionale(180).nullable().default(null),

		/* Orari */
		startsAtLocal: orarioLocale,
		endsAtLocal: orarioLocaleOpzionale,
		doorsAtLocal: orarioLocaleOpzionale,
		announceAtLocal: orarioLocaleOpzionale,
		isMultiDay: booleanoDaForm,

		/* Conflitti */
		conflictRadiusKm: interoOpzionale(1, 500).nullable().default(null),

		/* Ticketing */
		isFree: booleanoDaForm,
		isMembersOnly: booleanoDaForm,
		pricePresale: prezzoOpzionale,
		priceDoor: prezzoOpzionale,
		currency: z.string().trim().toUpperCase().length(3).default('EUR'),
		ticketUrl: urlOpzionale,
		ageRestriction: testoOpzionale(40),
		capacityExpected: interoOpzionale(1, 500000).nullable().default(null),

		/* Materiali e link */
		posterUrl: urlOpzionale,
		facebookEventUrl: urlOpzionale,
		instagramPostUrl: urlOpzionale,
		externalUrl: urlOpzionale,
		links: z.array(linkEventoSchema).max(20).default([]),

		/* Generi */
		primaryGenreSlug: testoOpzionale(80),
		secondaryGenreSlugs: z.array(z.string().trim().min(1).max(80)).max(12).default([]),

		/* Lineup */
		lineup: z.array(vocelineupSchema).max(60).default([]),

		/* Riservato */
		internalNotes: testoOpzionale(4000)
	})
	.superRefine((v, ctx) => {
		if (v.endsAtLocal && v.endsAtLocal <= v.startsAtLocal) {
			// Confronto fra stringhe: il formato `YYYY-MM-DDTHH:MM` è ordinabile
			// lessicograficamente, e su orari di parete è più corretto che
			// convertirli, perché non tocca il cambio d'ora.
			ctx.addIssue({
				code: 'custom',
				path: ['endsAtLocal'],
				message: 'La fine deve venire dopo l’inizio.'
			});
		}

		if (v.doorsAtLocal && v.doorsAtLocal > v.startsAtLocal) {
			ctx.addIssue({
				code: 'custom',
				path: ['doorsAtLocal'],
				message: 'Le porte non possono aprire dopo l’inizio del concerto.'
			});
		}

		if (v.announceAtLocal && v.announceAtLocal > v.startsAtLocal) {
			ctx.addIssue({
				code: 'custom',
				path: ['announceAtLocal'],
				message: 'Annunciare una data dopo che si è svolta non serve a molto.'
			});
		}

		// Il genere primario è l'unica cosa che gli altri vedono di un `hold`
		// insieme a giorno e città: senza, l'evento in calendario è muto.
		if (v.status === 'hold' && !v.primaryGenreSlug) {
			ctx.addIssue({
				code: 'custom',
				path: ['primaryGenreSlug'],
				message:
					'Per opzionare una data serve il genere principale: agli altri organizzatori è l’unica cosa che dice di che serata si tratta.'
			});
		}

		if (v.primaryGenreSlug && v.secondaryGenreSlugs.includes(v.primaryGenreSlug)) {
			ctx.addIssue({
				code: 'custom',
				path: ['secondaryGenreSlugs'],
				message: 'Il genere principale è già selezionato: non serve ripeterlo fra i secondari.'
			});
		}

		if (v.isFree && (v.pricePresale !== null || v.priceDoor !== null)) {
			ctx.addIssue({
				code: 'custom',
				path: ['isFree'],
				message: 'O è a ingresso libero, o ha un prezzo.'
			});
		}
	});

export type EventInput = z.infer<typeof eventSchema>;
export type VoceLineupInput = z.infer<typeof vocelineupSchema>;
export type LinkEventoInput = z.infer<typeof linkEventoSchema>;
export type StatoEvento = z.infer<typeof statoEvento>;

/** Tutti i generi dell'evento, in ordine: il primario per primo. */
export function generiInOrdine(dati: Pick<EventInput, 'primaryGenreSlug' | 'secondaryGenreSlugs'>) {
	const slugs = dati.primaryGenreSlug ? [dati.primaryGenreSlug] : [];
	for (const s of dati.secondaryGenreSlugs) if (!slugs.includes(s)) slugs.push(s);
	return slugs;
}
