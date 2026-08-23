/**
 * Schema dei feed ICS sottoscrivibili (ARCHITECTURE.md §8, ADR-0011).
 *
 * I filtri sono l'unica parte configurabile del feed. Vale la pena dirlo con
 * precisione perché è il punto in cui è facile fraintendere: **un filtro
 * restringe, non allarga**. Il contenuto del feed è deciso da
 * `serializeEvent()` sul profilo proprietario del token; questi campi possono
 * solo togliere date da quell'insieme, mai aggiungerne né mostrarne di più.
 */
import { z } from 'zod';
import { interoOpzionale, testoOpzionale } from './common';

/**
 * Gli stati che un feed può includere.
 *
 * `draft` non c'è, e non è una dimenticanza: una bozza è la sola cosa di cui
 * ADR-0005 promette che *nessun altro l'ha mai vista*, e un feed è servito da
 * un endpoint pubblico protetto solo da un segreto nell'URL, che finisce nei
 * server di Google o di Apple. Vedi ADR-0029.
 */
export const statoFeed = z.enum(['hold', 'confirmed', 'cancelled']);

export type StatoFeed = z.infer<typeof statoFeed>;

/** Il default: tutto ciò che un feed può contenere. */
export const STATI_FEED_PREDEFINITI: StatoFeed[] = ['hold', 'confirmed', 'cancelled'];

/**
 * Il centro del filtro "entro N km".
 *
 * Le coordinate sono risolte **una volta sola**, quando il feed si crea: un
 * client calendario interroga il feed ogni dodici ore e geocodificare a ogni
 * richiesta significherebbe bruciare il rate limit di Photon per un dato che
 * non cambia mai. Il nome della città resta accanto perché senza di esso
 * l'interfaccia mostrerebbe due numeri.
 */
export const centroFeed = z.object({
	citta: z.string().trim().min(1),
	lat: z.number().min(-90).max(90),
	lon: z.number().min(-180).max(180)
});

/**
 * Il contenuto della colonna `calendar_feeds.filters`.
 *
 * Tollerante in lettura: un feed salvato prima che un campo esistesse deve
 * continuare a funzionare, e il default giusto è sempre "nessun filtro".
 */
export const filtriFeed = z.object({
	/** Slug di genere. Vuoto significa tutti; i sottogeneri sono inclusi. */
	generi: z.array(z.string().trim().min(1)).default([]),
	stati: z.array(statoFeed).default(STATI_FEED_PREDEFINITI),
	organizzazioni: z.array(z.uuid()).default([]),
	raggioKm: z.number().int().min(1).max(2000).nullable().default(null),
	centro: centroFeed.nullable().default(null)
});

export type FiltriFeed = z.infer<typeof filtriFeed>;

export const FILTRI_VUOTI: FiltriFeed = {
	generi: [],
	stati: STATI_FEED_PREDEFINITI,
	organizzazioni: [],
	raggioKm: null,
	centro: null
};

/**
 * Legge la colonna `filters`, che è `jsonb` e quindi `unknown`.
 *
 * Non solleva mai: un filtro illeggibile deve degradare a "nessun filtro", non
 * far fallire il feed. Un calendario che smette di aggiornarsi è un guasto che
 * nessuno nota per settimane.
 */
export function leggiFiltri(grezzo: unknown): FiltriFeed {
	const esito = filtriFeed.safeParse(grezzo ?? {});
	return esito.success ? esito.data : FILTRI_VUOTI;
}

/* ------------------------------------------------------------------ *
 * Il form di creazione
 * ------------------------------------------------------------------ */

/**
 * I campi del form in `/settings/feeds`.
 *
 * Il centro non si scrive a mano in coordinate: si digita una città e il
 * salvataggio la geocodifica, come fa il form evento. Qui arriva solo il testo.
 */
export const feedSchema = z.object({
	label: z
		.string()
		.trim()
		.min(1, 'Dai un nome al feed: fra sei mesi ne avrai tre e non saprai quale disdire.')
		.max(80, 'Massimo 80 caratteri.'),
	generi: z.array(z.string().trim().min(1)).default([]),
	stati: z
		.array(statoFeed)
		.default(STATI_FEED_PREDEFINITI)
		// Un feed senza stati non conterrebbe niente, e sarebbe l'utente a
		// non capire perché. Meglio riportarlo al default che salvare il vuoto.
		.transform((v) => (v.length ? v : STATI_FEED_PREDEFINITI)),
	organizzazioni: z.array(z.uuid()).default([]),
	centroCitta: testoOpzionale(120),
	raggioKm: interoOpzionale(1, 2000)
});

export type FeedInput = z.infer<typeof feedSchema>;
