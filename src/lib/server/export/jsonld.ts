/**
 * JSON-LD `schema.org/MusicEvent` (ARCHITECTURE.md §8).
 *
 * Serve a due cose: l'export per gli aggregatori, e il blocco incluso nella
 * pagina di dettaglio.
 *
 * **Una regola sola decide cosa entra**: un evento diventa un `MusicEvent`
 * soltanto se è visibile per intero *e* è stato annunciato — cioè è
 * `confirmed` o `cancelled`. Le altre combinazioni restano fuori, e non per
 * prudenza generica:
 *
 * - una data in visibilità ridotta non ha un titolo né un luogo, e un
 *   `MusicEvent` senza `name` non è un dato incompleto, è un dato falso;
 * - una bozza o un'opzione **non sono eventi pubblici**. JSON-LD esiste per
 *   descrivere qualcosa a chi sta fuori: emetterlo per una data che ADR-0005
 *   tiene deliberatamente riservata sarebbe annunciarla in un formato pensato
 *   apposta per essere letto dalle macchine.
 *
 * `cancelled` invece resta, con `eventStatus: EventCancelled`: un annuncio
 * ritirato va detto proprio a chi l'annuncio l'aveva raccolto.
 */
import type { EventoSerializzato, EventoCompleto } from '$lib/server/visibility';
import { fineEffettiva } from '$lib/time';

export const CONTESTO = 'https://schema.org';

type Nodo = Record<string, unknown>;

function pulisci(n: Nodo): Nodo {
	return Object.fromEntries(
		Object.entries(n).filter(([, v]) => v !== null && v !== undefined && v !== '')
	);
}

function luogo(e: EventoCompleto): Nodo {
	const venue = e.venue;
	return pulisci({
		'@type': 'Place',
		name: venue?.name ?? e.city,
		address: pulisci({
			'@type': 'PostalAddress',
			streetAddress: venue?.address ?? undefined,
			addressLocality: e.city,
			addressRegion: e.province ?? e.region ?? undefined,
			addressCountry: e.country
		}),
		geo:
			venue || (e.lat != null && e.lon != null)
				? pulisci({
						'@type': 'GeoCoordinates',
						latitude: venue?.lat ?? e.lat,
						longitude: venue?.lon ?? e.lon
					})
				: undefined,
		maximumAttendeeCapacity: venue?.capacity ?? undefined
	});
}

function offerte(e: EventoCompleto, baseUrl: string): Nodo[] {
	if (e.isFree) {
		return [
			pulisci({
				'@type': 'Offer',
				price: '0',
				priceCurrency: e.currency,
				url: e.ticketUrl ?? `${baseUrl}/events/${e.id}`,
				availability: 'https://schema.org/InStock'
			})
		];
	}

	const prezzi: { prezzo: string; nome: string }[] = [];
	if (e.pricePresale) prezzi.push({ prezzo: e.pricePresale, nome: 'Prevendita' });
	if (e.priceDoor) prezzi.push({ prezzo: e.priceDoor, nome: 'Alla porta' });

	return prezzi.map((p) =>
		pulisci({
			'@type': 'Offer',
			name: p.nome,
			price: p.prezzo,
			priceCurrency: e.currency,
			url: e.ticketUrl ?? `${baseUrl}/events/${e.id}`
		})
	);
}

/**
 * Un `MusicEvent`, oppure `null` quando l'evento non è qualcosa che si possa
 * descrivere a chi sta fuori. Vedi l'intestazione del file.
 */
export function aMusicEvent(evento: EventoSerializzato, baseUrl: string): Nodo | null {
	if (evento.visibilita !== 'completa') return null;
	if (evento.status !== 'confirmed' && evento.status !== 'cancelled') return null;

	const e = evento;
	const offers = offerte(e, baseUrl);

	return pulisci({
		'@context': CONTESTO,
		'@type': 'MusicEvent',
		'@id': `${baseUrl}/events/${e.id}`,
		url: `${baseUrl}/events/${e.id}`,
		name: e.title,
		alternateName: e.subtitle ?? undefined,
		description: e.description ?? undefined,
		startDate: e.startsAt.toISOString(),
		endDate: fineEffettiva(e.startsAt, e.endsAt).toISOString(),
		doorTime: e.doorsAt?.toISOString() ?? undefined,
		eventStatus:
			e.status === 'cancelled'
				? 'https://schema.org/EventCancelled'
				: 'https://schema.org/EventScheduled',
		eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
		location: luogo(e),
		organizer: pulisci({
			'@type': 'Organization',
			name: e.organizzazione.name,
			url: e.organizzazione.website ?? undefined,
			email: e.organizzazione.emailContact ?? undefined
		}),
		// Solo le band annunciate arrivano fin qui: `serializeEvent` ha già
		// tolto le altre, in ogni stato (ADR-0020).
		performer: e.lineup.map((v) =>
			pulisci({
				'@type': 'MusicGroup',
				name: v.nome,
				'@id': v.artistId ? `${baseUrl}/artists/${v.artistId}` : undefined
			})
		),
		genre: e.generi.map((g) => g.name),
		image: e.posterUrl ?? undefined,
		isAccessibleForFree: e.isFree,
		typicalAgeRange: e.ageRestriction ?? undefined,
		offers: offers.length ? offers : undefined
	});
}

/**
 * L'export JSON-LD: un `@graph` invece di un array nudo, così il file resta
 * un documento JSON-LD valido e non una lista di documenti.
 */
export function esportaJsonLd(eventi: EventoSerializzato[], opzioni: { baseUrl: string }): Nodo {
	const nodi = eventi
		.map((e) => aMusicEvent(e, opzioni.baseUrl))
		.filter((n): n is Nodo => n !== null)
		// Il `@context` è già in testa al documento: ripeterlo su ogni nodo è
		// lecito ma raddoppia il file per niente.
		.map((n) => {
			const copia = { ...n };
			delete copia['@context'];
			return copia;
		});

	return { '@context': CONTESTO, '@graph': nodi };
}
