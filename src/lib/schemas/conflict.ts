/**
 * Schema della bozza per l'anteprima dei conflitti (ARCHITECTURE.md §6.5).
 *
 * È volutamente **più permissivo** di `eventSchema`: l'anteprima gira mentre
 * l'utente sta ancora compilando, e un form incompleto è la condizione
 * normale, non un errore. Rifiutare la bozza perché manca il titolo
 * significherebbe mostrare l'avviso di conflitto solo a chi ha già finito,
 * cioè quando non serve più a niente.
 *
 * Prende solo i campi che il motore usa davvero. Tutto il resto del form —
 * prezzi, locandina, note interne — non entra in nessuna delle quattro
 * regole, e non ha motivo di viaggiare a ogni battuta di tasto.
 */
import { z } from 'zod';
import { booleanoDaForm, interoOpzionale, testoOpzionale, uuidOpzionale } from './common';

/**
 * Una riga di lineup, ridotta all'osso.
 *
 * Solo `artistId`: due band scritte a mano da due organizzatori diversi non
 * sono confrontabili, e il motore le ignora comunque (ADR-0006). Il nome non
 * serve nemmeno per mostrare l'avviso — quello lo risolve il server
 * dall'anagrafica, e solo per le band che si possono nominare.
 */
export const vocelineupBozzaSchema = z.object({
	artistId: uuidOpzionale,
	isAnnounced: booleanoDaForm
});

export const bozzaConflittiSchema = z.object({
	/** Presente in modifica: serve a non far scontrare una data con sé stessa. */
	eventId: uuidOpzionale,
	organizationId: z.uuid('Organizzazione non valida.'),
	venueId: uuidOpzionale,
	city: z.string().trim().max(120).default(''),
	/** Orario di parete. Vuoto è ammesso: senza data non si controlla niente. */
	startsAtLocal: z.string().trim().max(20).default(''),
	endsAtLocal: z.string().trim().max(20).default(''),
	doorsAtLocal: z.string().trim().max(20).default(''),
	conflictRadiusKm: interoOpzionale(1, 500).nullable().default(null),
	primaryGenreSlug: testoOpzionale(80),
	secondaryGenreSlugs: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
	lineup: z.array(vocelineupBozzaSchema).max(60).default([])
});

export type BozzaConflitti = z.infer<typeof bozzaConflittiSchema>;
