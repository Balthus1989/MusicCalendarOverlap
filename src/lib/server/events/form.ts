/**
 * Traduzione fra il `FormData` del browser e lo schema Zod dell'evento.
 *
 * Sta qui e non nella rotta perché serve identica in tre punti: creazione,
 * modifica e — da Fase 3 — anteprima dei conflitti su una bozza non ancora
 * salvata. Tre copie di questa funzione sarebbero tre modi diversi di
 * interpretare lo stesso form.
 */
import type { z } from 'zod';
import type { ValoriEvento, VoceLineupForm } from '$lib/events';
import { eventSchema } from '$lib/schemas/event';
import { formValues, righeIndicizzate, valoriMultipli } from '$lib/server/forms';
import { aLocaleInput } from '$lib/time';

/** Una riga di lineup senza né artista né nome è un widget vuoto, non un dato. */
function rigaLineupVuota(riga: Record<string, string>): boolean {
	return !riga.artistId?.trim() && !riga.artistName?.trim();
}

function rigaLinkVuota(riga: Record<string, string>): boolean {
	return !riga.label?.trim() && !riga.url?.trim();
}

/**
 * Estrae dal form la forma che `eventSchema` si aspetta.
 *
 * I checkbox non spuntati non compaiono affatto nel `FormData`: è `booleanoDaForm`
 * a farne dei `false`, non questa funzione, che si limita a non inventarli.
 */
export function datiEventoDaForm(form: FormData): Record<string, unknown> {
	return {
		...formValues(form),
		secondaryGenreSlugs: valoriMultipli(form, 'secondaryGenreSlugs'),
		lineup: righeIndicizzate(form, 'lineup').filter((r) => !rigaLineupVuota(r)),
		links: righeIndicizzate(form, 'links').filter((r) => !rigaLinkVuota(r))
	};
}

export type EsitoParse =
	| { ok: true; dati: z.infer<typeof eventSchema> }
	| { ok: false; errori: Record<string, string>; primo: string };

/**
 * Valida il form e appiattisce gli errori in `campo → messaggio`.
 *
 * Per la lineup il percorso Zod è `lineup.2.artistName`: si tiene così com'è,
 * perché è esattamente il `name` dell'input a schermo e permette di evidenziare
 * la riga giusta.
 */
export function validaEvento(form: FormData): EsitoParse {
	const parsed = eventSchema.safeParse(datiEventoDaForm(form));
	if (parsed.success) return { ok: true, dati: parsed.data };

	const errori: Record<string, string> = {};
	for (const issue of parsed.error.issues) {
		const chiave = issue.path.join('.') || 'form';
		if (!(chiave in errori)) errori[chiave] = issue.message;
	}

	const primo = Object.values(errori)[0] ?? 'Dati non validi.';
	return { ok: false, errori, primo };
}

/* ------------------------------------------------------------------ *
 * Valori per il componente
 * ------------------------------------------------------------------ */

const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Valori di partenza per una data nuova. */
export function valoriPredefiniti(org: {
	id: string;
	city: string | null;
	province: string | null;
}): ValoriEvento {
	return {
		organizationId: org.id,
		// Si parte sempre in bozza: è l'unico stato da cui si può andare
		// ovunque, e nessuno pubblica per sbaglio qualcosa che non voleva.
		status: 'draft',
		title: '',
		subtitle: '',
		description: '',
		venueId: '',
		// La sede dell'organizzazione è il luogo più probabile: si può
		// cambiare, ma nove volte su dieci è già giusta.
		city: org.city ?? '',
		province: org.province ?? '',
		region: '',
		startsAtLocal: '',
		endsAtLocal: '',
		doorsAtLocal: '',
		announceAtLocal: '',
		isMultiDay: false,
		conflictRadiusKm: '',
		isFree: false,
		isMembersOnly: false,
		pricePresale: '',
		priceDoor: '',
		ticketUrl: '',
		ageRestriction: '',
		capacityExpected: '',
		posterUrl: '',
		facebookEventUrl: '',
		instagramPostUrl: '',
		externalUrl: '',
		primaryGenreSlug: '',
		secondaryGenreSlugs: [],
		internalNotes: '',
		lineup: [],
		links: []
	};
}

/**
 * Rimanda al form ciò che l'utente aveva scritto, dopo un errore di
 * validazione. Su un form da trenta campi, ripresentarlo vuoto sarebbe il modo
 * più rapido di far smettere qualcuno di usare il prodotto.
 */
export function valoriDaForm(form: FormData): ValoriEvento {
	const g = (nome: string) => s(form.get(nome));
	const acceso = (nome: string) => form.get(nome) !== null;

	return {
		organizationId: g('organizationId'),
		status: (g('status') || 'draft') as ValoriEvento['status'],
		title: g('title'),
		subtitle: g('subtitle'),
		description: g('description'),
		venueId: g('venueId'),
		city: g('city'),
		province: g('province'),
		region: g('region'),
		startsAtLocal: g('startsAtLocal'),
		endsAtLocal: g('endsAtLocal'),
		doorsAtLocal: g('doorsAtLocal'),
		announceAtLocal: g('announceAtLocal'),
		isMultiDay: acceso('isMultiDay'),
		conflictRadiusKm: g('conflictRadiusKm'),
		isFree: acceso('isFree'),
		isMembersOnly: acceso('isMembersOnly'),
		pricePresale: g('pricePresale'),
		priceDoor: g('priceDoor'),
		ticketUrl: g('ticketUrl'),
		ageRestriction: g('ageRestriction'),
		capacityExpected: g('capacityExpected'),
		posterUrl: g('posterUrl'),
		facebookEventUrl: g('facebookEventUrl'),
		instagramPostUrl: g('instagramPostUrl'),
		externalUrl: g('externalUrl'),
		primaryGenreSlug: g('primaryGenreSlug'),
		secondaryGenreSlugs: valoriMultipli(form, 'secondaryGenreSlugs'),
		internalNotes: g('internalNotes'),
		lineup: righeIndicizzate(form, 'lineup')
			.filter((r) => !rigaLineupVuota(r))
			.map((r) => ({
				id: r.id || null,
				artistId: r.artistId || null,
				artistName: s(r.artistName),
				billing: (r.billing || 'support') as VoceLineupForm['billing'],
				stage: s(r.stage),
				setStartsAtLocal: s(r.setStartsAtLocal),
				// Un checkbox indicizzato non spuntato non arriva affatto: la
				// riga esiste, il campo no.
				isAnnounced: r.isAnnounced === 'on' || r.isAnnounced === 'true'
			})),
		links: righeIndicizzate(form, 'links')
			.filter((r) => !rigaLinkVuota(r))
			.map((r) => ({ label: s(r.label), url: s(r.url) }))
	};
}

type RigaEvento = {
	organizationId: string;
	status: ValoriEvento['status'];
	title: string;
	subtitle: string | null;
	description: string | null;
	venueId: string | null;
	city: string;
	province: string | null;
	region: string | null;
	startsAt: Date;
	endsAt: Date | null;
	doorsAt: Date | null;
	announceAt: Date | null;
	isMultiDay: boolean;
	conflictRadiusKm: number | null;
	isFree: boolean;
	isMembersOnly: boolean;
	pricePresale: string | null;
	priceDoor: string | null;
	ticketUrl: string | null;
	ageRestriction: string | null;
	capacityExpected: number | null;
	posterUrl: string | null;
	facebookEventUrl: string | null;
	instagramPostUrl: string | null;
	externalUrl: string | null;
	internalNotes: string | null;
	eventGenres: { isPrimary: boolean; genre: { slug: string } }[];
	lineup: {
		id: string;
		artistId: string | null;
		artistNameRaw: string | null;
		billing: VoceLineupForm['billing'];
		stage: string | null;
		setStartsAt: Date | null;
		isAnnounced: boolean;
		artist: { id: string; name: string } | null;
	}[];
	links: { label: string; url: string }[];
};

/** Dalla riga salvata ai valori del form di modifica. */
export function valoriDaEvento(e: RigaEvento): ValoriEvento {
	const primario = e.eventGenres.find((g) => g.isPrimary)?.genre.slug ?? '';

	return {
		organizationId: e.organizationId,
		status: e.status,
		title: e.title,
		subtitle: s(e.subtitle),
		description: s(e.description),
		venueId: s(e.venueId),
		city: e.city,
		province: s(e.province),
		region: s(e.region),
		startsAtLocal: aLocaleInput(e.startsAt),
		endsAtLocal: aLocaleInput(e.endsAt),
		doorsAtLocal: aLocaleInput(e.doorsAt),
		announceAtLocal: aLocaleInput(e.announceAt),
		isMultiDay: e.isMultiDay,
		conflictRadiusKm: s(e.conflictRadiusKm),
		isFree: e.isFree,
		isMembersOnly: e.isMembersOnly,
		pricePresale: s(e.pricePresale),
		priceDoor: s(e.priceDoor),
		ticketUrl: s(e.ticketUrl),
		ageRestriction: s(e.ageRestriction),
		capacityExpected: s(e.capacityExpected),
		posterUrl: s(e.posterUrl),
		facebookEventUrl: s(e.facebookEventUrl),
		instagramPostUrl: s(e.instagramPostUrl),
		externalUrl: s(e.externalUrl),
		primaryGenreSlug: primario,
		secondaryGenreSlugs: e.eventGenres.filter((g) => !g.isPrimary).map((g) => g.genre.slug),
		internalNotes: s(e.internalNotes),
		lineup: e.lineup.map((v) => ({
			id: v.id,
			artistId: v.artistId,
			artistName: v.artist?.name ?? s(v.artistNameRaw),
			billing: v.billing,
			stage: s(v.stage),
			setStartsAtLocal: aLocaleInput(v.setStartsAt),
			isAnnounced: v.isAnnounced
		})),
		links: e.links.map((l) => ({ label: l.label, url: l.url }))
	};
}
