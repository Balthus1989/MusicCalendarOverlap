/**
 * Dal bersaglio del parser ai valori del form evento.
 *
 * È l'unico punto in cui le tre sorgenti — testo, `.ics`, CSV — diventano un
 * form, e per questo è codice puro con test caso per caso: qui un errore non
 * fa rumore, riempie un campo con la cosa sbagliata e lascia che sia una
 * persona distratta a salvarla.
 *
 * Tre cose che questa funzione **non** fa, e sono le tre che contano:
 *
 * 1. **Non decide lo stato.** Il form parte da `valoriPredefiniti()`, cioè in
 *    bozza, e ci resta. Un post pubblico *sembra* dire che la data è
 *    confermata, ma confermare significa annunciare, e non lo annuncia un
 *    parser (ADR-0031).
 * 2. **Non annuncia le band.** Ogni riga di lineup nasce con `isAnnounced`
 *    falso, per la stessa ragione: la rivelazione progressiva di ADR-0005 è
 *    una decisione di chi porta la band.
 * 3. **Non collega le band all'anagrafica.** `artistId` resta vuoto e i
 *    candidati viaggiano a parte, come proposte da confermare (§9 punto 4).
 *    Un collegamento sbagliato non si vede nel form e falsa la regola R2.
 *
 * Ciò che ha riempito lo dice: `compilati` è l'elenco dei `name` degli input
 * toccati, e l'interfaccia li segna come da rivedere.
 */
import type { ValoriEvento, VoceLineupForm } from '$lib/events';
import type { BersaglioParse } from '$lib/schemas/parse';
import { normalizeName, looksLikeDuplicate } from '$lib/server/text';

export type GenereNoto = { slug: string; name: string; path: string };
export type LocaleNoto = { id: string; name: string; city: string; province: string | null };

export type ContestoForm = {
	/** Da `valoriPredefiniti(org)`: organizzazione, stato e città di partenza. */
	base: ValoriEvento;
	generi: GenereNoto[];
	locali: LocaleNoto[];
};

export type EsitoVersoIlForm = {
	valori: ValoriEvento;
	/** I `name` degli input che il parser ha riempito. */
	compilati: string[];
	/** Cosa non ha saputo collocare, in italiano, da mostrare sotto il form. */
	avvisi: string[];
};

/* ------------------------------------------------------------------ *
 * Normalizzazioni
 * ------------------------------------------------------------------ */

const FORMATO_LOCALE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Un orario di parete valido, o niente. Mai un orario a metà. */
function orario(v: string | null): string {
	if (!v) return '';
	const t = v.trim();
	return FORMATO_LOCALE.test(t) ? t.slice(0, 16) : '';
}

/**
 * `12,50 €`, `€ 12.50`, `12 euro` → `12,50`.
 *
 * Il form accetta già la virgola (`prezzoOpzionale`), quindi qui basta
 * liberare il numero da ciò che lo circonda. Senza questo passaggio un prezzo
 * copiato da un post fa fallire la validazione con un messaggio che parla di
 * numeri, davanti a un campo in cui c'è scritto «12,50 €».
 */
export function prezzo(v: string | null): string {
	if (!v) return '';
	const m = /(\d+(?:[.,]\d{1,2})?)/.exec(v.replace(/\s/g, ''));
	return m ? m[1] : '';
}

/**
 * Un indirizzo utilizzabile, o niente.
 *
 * Lo schema del form pretende `http://` o `https://`. Un post scrive
 * `bandcamp.com/qualcosa`, e rifiutarlo per la mancanza dello schema
 * significherebbe far ridigitare a mano un link corretto. Si antepone
 * `https://`, che è l'unica scelta ragionevole rimasta.
 */
export function url(v: string | null): string {
	if (!v) return '';
	const t = v.trim().replace(/[.,;)\]]+$/, '');
	if (!t) return '';
	if (/^https?:\/\//i.test(t)) return t;
	// Deve almeno somigliare a un dominio: `TBA` non diventa `https://TBA`.
	return /^[\w-]+(\.[\w-]+)+(\/|$)/.test(t) ? `https://${t}` : '';
}

/* ------------------------------------------------------------------ *
 * Generi
 * ------------------------------------------------------------------ */

export type EsitoGeneri = { slugs: string[]; nonRiconosciuti: string[] };

/**
 * Da nomi liberi agli slug della tassonomia chiusa (ADR-0007).
 *
 * Serve identica a tutte e tre le sorgenti: un `CATEGORIES` di un `.ics`, la
 * colonna `generi` di un CSV e ciò che il modello legge in un post sono la
 * stessa cosa, cioè un nome scritto da un umano. Una funzione sola, così il
 * comportamento non dipende da come è arrivato il testo.
 *
 * I generi che non si riconoscono **non si inventano**: la tassonomia è chiusa
 * e solo un platform admin la allarga. Tornano indietro come avviso, che è
 * l'informazione utile — «questa serata era etichettata "crust", nel
 * calendario quel genere non c'è».
 */
export function risolviGeneri(nomi: string[], tassonomia: GenereNoto[]): EsitoGeneri {
	const perSlug = new Map(tassonomia.map((g) => [g.slug, g]));
	const perNome = new Map(tassonomia.map((g) => [normalizeName(g.name), g]));
	const perSlugNorm = new Map(tassonomia.map((g) => [normalizeName(g.slug), g]));

	const slugs: string[] = [];
	const nonRiconosciuti: string[] = [];

	for (const grezzo of nomi) {
		const t = grezzo.trim();
		if (!t) continue;
		const n = normalizeName(t);

		const trovato =
			perSlug.get(t) ??
			perNome.get(n) ??
			perSlugNorm.get(n) ??
			// Ultimo tentativo, sui refusi: "deathmetal", "death-metall".
			tassonomia.find((g) => looksLikeDuplicate(g.name, t) || looksLikeDuplicate(g.slug, t));

		if (trovato) {
			if (!slugs.includes(trovato.slug)) slugs.push(trovato.slug);
		} else if (!nonRiconosciuti.includes(t)) nonRiconosciuti.push(t);
	}

	return { slugs, nonRiconosciuti };
}

/* ------------------------------------------------------------------ *
 * Locale
 * ------------------------------------------------------------------ */

/**
 * Il locale in anagrafica che corrisponde al nome letto, se è **uno solo**.
 *
 * Solo il nome identico a meno di accenti e punteggiatura, non la somiglianza:
 * fra "Circolo Arci Lupo Bianco" e "Circolo Arci Lupo Grigio" la distanza di
 * edit è piccola e i due locali sono in due paesi diversi. Su un campo che
 * decide anche le coordinate — e quindi i conflitti geografici — un quasi-match
 * silenzioso è peggio di un campo vuoto.
 *
 * Due omonimi in due città diverse si disambiguano con la città quando c'è; se
 * restano due, non si sceglie.
 */
export function risolviLocale(
	nome: string | null,
	citta: string | null,
	locali: LocaleNoto[]
): LocaleNoto | null {
	if (!nome?.trim()) return null;
	const n = normalizeName(nome);
	if (!n) return null;

	const candidati = locali.filter((l) => normalizeName(l.name) === n);
	if (candidati.length === 1) return candidati[0];
	if (candidati.length === 0) return null;

	if (citta?.trim()) {
		const c = normalizeName(citta);
		const inCitta = candidati.filter((l) => normalizeName(l.city) === c);
		if (inCitta.length === 1) return inCitta[0];
	}

	return null;
}

/* ------------------------------------------------------------------ *
 * La mappatura
 * ------------------------------------------------------------------ */

export function versoIlForm(b: BersaglioParse, ctx: ContestoForm): EsitoVersoIlForm {
	const valori: ValoriEvento = { ...ctx.base, secondaryGenreSlugs: [], lineup: [], links: [] };
	const compilati: string[] = [];
	const avvisi: string[] = [...b.incerti];

	/** Scrive il campo solo se c'è qualcosa da scrivere, e lo segna. */
	const metti = <K extends keyof ValoriEvento>(campo: K, v: ValoriEvento[K] | '' | null) => {
		if (v === '' || v === null || (Array.isArray(v) && v.length === 0)) return;
		valori[campo] = v as ValoriEvento[K];
		compilati.push(campo);
	};

	metti('title', b.title?.trim() ?? '');
	metti('subtitle', b.subtitle?.trim() ?? '');
	metti('description', b.description?.trim() ?? '');

	/* Luogo */
	metti('city', b.city?.trim() ?? '');
	metti('province', b.province?.trim().toUpperCase().slice(0, 2) ?? '');

	const locale = risolviLocale(b.venueName, b.city, ctx.locali);
	if (locale) {
		metti('venueId', locale.id);
		// Il locale porta con sé la città giusta: quella letta nel testo può
		// essere il comune del pubblico, non quello del locale.
		if (!valori.city) metti('city', locale.city);
	} else if (b.venueName?.trim()) {
		avvisi.push(
			`Il locale «${b.venueName.trim()}» non è in anagrafica, o ce n’è più d’uno con quel nome: scegli tu dall’elenco.`
		);
	}

	/* Orari */
	metti('startsAtLocal', orario(b.startsAtLocal));
	metti('endsAtLocal', orario(b.endsAtLocal));
	metti('doorsAtLocal', orario(b.doorsAtLocal));

	if (b.startsAtLocal && !valori.startsAtLocal) {
		avvisi.push(`La data letta — «${b.startsAtLocal}» — non è utilizzabile: va scritta a mano.`);
	}

	/* Ticketing */
	const prevendita = prezzo(b.pricePresale);
	const porta = prezzo(b.priceDoor);
	metti('pricePresale', prevendita);
	metti('priceDoor', porta);

	if (b.isFree && (prevendita || porta)) {
		// Lo schema del form rifiuta i due insieme, e ha ragione. La
		// contraddizione però è nel testo di partenza, non nel form: si tiene
		// il prezzo, che è il dato più specifico, e si dice che c'era.
		avvisi.push(
			'Nel testo compaiono sia un ingresso libero sia un prezzo: è rimasto il prezzo, controlla.'
		);
	} else if (b.isFree) {
		metti('isFree', true);
	}

	metti('ticketUrl', url(b.ticketUrl));
	metti('ageRestriction', b.ageRestriction?.trim() ?? '');
	metti('externalUrl', url(b.externalUrl));
	metti('facebookEventUrl', url(b.facebookEventUrl));
	metti('instagramPostUrl', url(b.instagramPostUrl));

	/* Generi */
	const generi = risolviGeneri(b.genres, ctx.generi);
	if (generi.slugs.length) {
		metti('primaryGenreSlug', generi.slugs[0]);
		metti('secondaryGenreSlugs', generi.slugs.slice(1, 13));
	}
	if (generi.nonRiconosciuti.length) {
		avvisi.push(
			`Generi non presenti nella tassonomia del calendario: ${generi.nonRiconosciuti.join(', ')}.`
		);
	}

	/* Lineup */
	const lineup: VoceLineupForm[] = b.lineup
		.filter((v) => v.name.trim())
		.map((v) => ({
			id: null,
			// Vuoto di proposito: il collegamento all'anagrafica è una proposta
			// da confermare, non un esito del parser. Vedi `match.ts`.
			artistId: null,
			artistName: v.name.trim(),
			billing: v.billing ?? 'support',
			stage: '',
			setStartsAtLocal: '',
			// Mai vero, in nessuna sorgente. Vedi l'intestazione del file.
			isAnnounced: false
		}));

	metti('lineup', lineup);

	return { valori, compilati, avvisi };
}
