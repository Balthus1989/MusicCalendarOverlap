/**
 * Il bersaglio dell'import assistito (ARCHITECTURE.md §9, Fase 5).
 *
 * Una forma sola per **tutte e tre** le sorgenti: il testo incollato letto da
 * un modello, un file `.ics`, un CSV. Le prime due righe di `sniff.ts`
 * decidono da quale strada si arriva, ma il punto di arrivo è questo, e da qui
 * in poi il codice è uno solo. Tre forme diverse avrebbero voluto dire tre
 * mappature verso il form, cioè tre posti dove sbagliare la stessa cosa.
 *
 * I nomi dei campi ricalcano quelli di `ValoriEvento` dove esiste un
 * corrispondente, perché `versoIlForm()` deve restare una traduzione ovvia e
 * verificabile a occhio. Divergono solo dove il parser **non può** sapere ciò
 * che il form pretende:
 *
 * - `venueName` invece di `venueId`: un post dice "al Circolo Arci Lupo
 *   Bianco", non un UUID. La risoluzione all'anagrafica è nostra e resta una
 *   proposta da confermare.
 * - `genres` sono nomi liberi, non slug della tassonomia chiusa (ADR-0007).
 *   Li risolve `risolviGeneri()`, con la stessa funzione per tutte e tre le
 *   sorgenti.
 *
 * Non ci sono `transform()` in questo schema, ed è deliberato: lo stesso
 * oggetto viene passato all'API come formato di output forzato, e un JSON
 * Schema non sa esprimere una trasformazione. La normalizzazione sta tutta
 * dopo, in `versoIlForm()`.
 *
 * **Quattro campi non compaiono qui, e non è una dimenticanza:**
 * `organizationId`, `status`, `internalNotes` e `isAnnounced` sulle righe di
 * lineup. Nessuno dei quattro si desume da un post, e ognuno dei quattro
 * deciderebbe qualcosa che spetta a una persona (ADR-0031).
 */
import { z } from 'zod';
import { ruoloLocandina } from './event';

/**
 * Una band riconosciuta nel testo.
 *
 * `billing` è nullo quando il testo non lo dice: quasi sempre. L'ordine di
 * locandina è già l'informazione principale, e inventare "headliner" perché
 * un nome sta in cima significherebbe scrivere nel form una cosa che il post
 * non diceva.
 */
export const vocelineupParse = z.object({
	name: z.string().min(1).max(200),
	billing: ruoloLocandina.nullable()
});

export const bersaglioParse = z.object({
	title: z.string().max(200).nullable(),
	subtitle: z.string().max(200).nullable(),
	description: z.string().max(5000).nullable(),

	/* Luogo. `city` è l'unico campo che il form pretende sempre. */
	venueName: z.string().max(200).nullable(),
	address: z.string().max(300).nullable(),
	city: z.string().max(120).nullable(),
	/** Sigla di due lettere, quando il testo la dice o la città è nota. */
	province: z.string().max(2).nullable(),

	/* Orari, come orario di parete `YYYY-MM-DDTHH:MM` (mai un istante). */
	startsAtLocal: z.string().max(16).nullable(),
	endsAtLocal: z.string().max(16).nullable(),
	doorsAtLocal: z.string().max(16).nullable(),

	/* Ticketing */
	isFree: z.boolean(),
	pricePresale: z.string().max(20).nullable(),
	priceDoor: z.string().max(20).nullable(),
	ticketUrl: z.string().max(500).nullable(),
	ageRestriction: z.string().max(40).nullable(),

	/* Link */
	externalUrl: z.string().max(500).nullable(),
	facebookEventUrl: z.string().max(500).nullable(),
	instagramPostUrl: z.string().max(500).nullable(),

	/** Nomi di genere come compaiono nel testo: `risolviGeneri()` li mappa. */
	genres: z.array(z.string().min(1).max(80)).max(12),

	lineup: z.array(vocelineupParse).max(60),

	/**
	 * Ciò che il parser ha letto ma non ha saputo dove mettere.
	 *
	 * Esiste perché il fallimento silenzioso è il modo peggiore di sbagliare:
	 * un campo lasciato vuoto senza dirlo si legge come "nel post non c'era",
	 * e chi rivede il form non va a ricontrollare. Questi finiscono sotto il
	 * pannello, non dentro un campo.
	 */
	incerti: z.array(z.string().min(1).max(300)).max(20)
});

export type BersaglioParse = z.infer<typeof bersaglioParse>;
export type VoceLineupParse = z.infer<typeof vocelineupParse>;

/** Un bersaglio completamente vuoto: la base da cui partono i tre parser. */
export function bersaglioVuoto(): BersaglioParse {
	return {
		title: null,
		subtitle: null,
		description: null,
		venueName: null,
		address: null,
		city: null,
		province: null,
		startsAtLocal: null,
		endsAtLocal: null,
		doorsAtLocal: null,
		isFree: false,
		pricePresale: null,
		priceDoor: null,
		ticketUrl: null,
		ageRestriction: null,
		externalUrl: null,
		facebookEventUrl: null,
		instagramPostUrl: null,
		genres: [],
		lineup: [],
		incerti: []
	};
}
