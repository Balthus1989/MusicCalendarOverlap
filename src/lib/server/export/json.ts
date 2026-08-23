/**
 * Export JSON (ARCHITECTURE.md §8, principio 6: dati esportabili).
 *
 * Lo scopo dichiarato è il **reimport**: qualcuno deve poter portarsi via
 * tutto e rimetterlo altrove, o rimetterlo qui dopo un disastro. Da lì due
 * conseguenze sulla forma.
 *
 * La prima è `versione`: un file esportato oggi deve restare leggibile quando
 * la forma cambierà, e l'unico modo è dire fin da subito quale forma è.
 *
 * La seconda è il campo `visibilita` su ogni riga, che a prima vista sembra un
 * dettaglio interno. Non lo è: senza, una data opzionata altrui — di cui si
 * conoscono giorno, città e genere e nient'altro — si esporterebbe come un
 * evento con dieci campi nulli, indistinguibile da un evento svuotato. Chi
 * reimporta deve poter sapere che quei campi non mancano, sono riservati.
 *
 * Codice puro su `EventoSerializzato`: il tipo grezzo non è raggiungibile da
 * qui, ed è ciò che rende l'export incapace di esportare più di quanto si veda.
 */
import { oraCivile } from '$lib/time';
import type { EventoSerializzato } from '$lib/server/visibility';

export const VERSIONE_EXPORT = 1;

export type EventoEsportato = ReturnType<typeof aEventoEsportato>;

export function aEventoEsportato(e: EventoSerializzato, baseUrl: string) {
	const base = {
		id: e.id,
		url: `${baseUrl}/events/${e.id}`,
		stato: e.status,
		proprio: e.proprio,
		giorno: e.giorno,
		citta: e.city,
		provincia: e.province,
		organizzazione: {
			nome: e.organizzazione.name,
			slug: e.organizzazione.slug,
			email: e.organizzazione.emailContact,
			sito: e.organizzazione.website
		}
	};

	// Il letterale e non `e.visibilita`: così `EventoEsportato` è un'unione
	// discriminata vera, e chi legge il risultato non può leggere `titolo` da
	// una riga ridotta senza che il compilatore lo fermi.
	if (e.visibilita === 'ridotta') {
		return {
			...base,
			visibilita: 'ridotta' as const,
			generePrimario: e.generePrimario
				? { slug: e.generePrimario.slug, nome: e.generePrimario.name }
				: null
		};
	}

	return {
		...base,
		visibilita: 'completa' as const,
		titolo: e.title,
		sottotitolo: e.subtitle,
		descrizione: e.description,
		inizio: e.startsAt.toISOString(),
		inizioOra: oraCivile(e.startsAt),
		fine: e.endsAt?.toISOString() ?? null,
		porte: e.doorsAt?.toISOString() ?? null,
		multiGiorno: e.isMultiDay,
		regione: e.region,
		paese: e.country,
		lat: e.lat,
		lon: e.lon,
		locale: e.venue
			? {
					id: e.venue.id,
					nome: e.venue.name,
					indirizzo: e.venue.address,
					citta: e.venue.city,
					provincia: e.venue.province,
					lat: e.venue.lat,
					lon: e.venue.lon,
					capienza: e.venue.capacity
				}
			: null,
		generi: e.generi.map((g) => ({ slug: g.slug, nome: g.name, principale: g.isPrimary })),
		// Già filtrata da `serializeEvent`: fuori dall'organizzazione
		// proprietaria contiene solo le voci annunciate (ADR-0020).
		lineup: e.lineup.map((v) => ({
			artistaId: v.artistId,
			nome: v.nome,
			ruolo: v.billing,
			posizione: v.position,
			palco: v.stage,
			giorno: v.dayDate,
			inizioSet: v.setStartsAt?.toISOString() ?? null,
			durataMinuti: v.setDurationMinutes
		})),
		ingresso: {
			gratuito: e.isFree,
			soloTesserati: e.isMembersOnly,
			prevendita: e.pricePresale,
			porta: e.priceDoor,
			valuta: e.currency,
			ticketUrl: e.ticketUrl,
			eta: e.ageRestriction
		},
		locandina: e.posterUrl,
		link: [
			...(e.facebookEventUrl ? [{ etichetta: 'Facebook', url: e.facebookEventUrl }] : []),
			...(e.instagramPostUrl ? [{ etichetta: 'Instagram', url: e.instagramPostUrl }] : []),
			...(e.externalUrl ? [{ etichetta: 'Sito', url: e.externalUrl }] : []),
			...e.links.map((l) => ({ etichetta: l.label, url: l.url }))
		],
		// `internalNotes` e `announceAt` escono solo se sono i propri: è
		// `serializeEvent` ad averli già azzerati altrove, qui si copia e basta.
		noteInterne: e.internalNotes,
		annuncioPrevisto: e.announceAt?.toISOString() ?? null
	};
}

export type ExportJson = {
	versione: number;
	generatoIl: string;
	finestra: { da: string; a: string };
	eventi: EventoEsportato[];
};

export function esportaJson(
	eventi: EventoSerializzato[],
	opzioni: { baseUrl: string; da: Date; a: Date; adesso?: Date }
): ExportJson {
	return {
		versione: VERSIONE_EXPORT,
		generatoIl: (opzioni.adesso ?? new Date()).toISOString(),
		finestra: { da: opzioni.da.toISOString(), a: opzioni.a.toISOString() },
		eventi: eventi.map((e) => aEventoEsportato(e, opzioni.baseUrl))
	};
}
