/**
 * Fixture condivisa delle uscite di Fase 4 — feed ICS, export, copy social.
 *
 * Tutti e tre partono dallo stesso posto: una riga `events` con le sue
 * relazioni, fatta passare da `serializeEvent()`. Che la fixture sia una sola
 * non è economia di righe: se ogni suite si costruisse la propria, il giorno
 * in cui una band non annunciata comparisse in un solo formato lo scoprirebbe
 * una suite e le altre no.
 *
 * La data è deliberatamente scomoda: 12 ottobre, ora legale, concerto che
 * finisce dopo la mezzanotte, un genere primario e uno secondario, una band
 * annunciata e una no, un locale, due prezzi e il tesseramento.
 *
 * Non è un file `.test.ts`: vitest non lo raccoglie come suite.
 */
import {
	serializeEvent,
	type EventWithRelations,
	type EventoSerializzato,
	type ViewerContext
} from '../../../src/lib/server/visibility';
import { daLocaleAIstante } from '../../../src/lib/time';

export const ORG_MIA = 'aaaaaaaa-0000-0000-0000-000000000000';
export const ORG_ALTRA = 'bbbbbbbb-0000-0000-0000-000000000000';
export const BASE = 'https://calendario.example';
export const ID_EVENTO = 'e1111111-0000-0000-0000-000000000000';

/** Chi la data ce l'ha in casa: vede tutto, in ogni stato. */
export const proprietario: ViewerContext = {
	profileId: 'p1',
	organizationIds: [ORG_ALTRA],
	roles: { [ORG_ALTRA]: 'owner' },
	isPlatformAdmin: false
};

/** Chi guarda da fuori: la matrice di §5 si applica per intero. */
export const estraneo: ViewerContext = {
	profileId: 'p2',
	organizationIds: [ORG_MIA],
	roles: { [ORG_MIA]: 'member' },
	isPlatformAdmin: false
};

export const AGGIORNATO = daLocaleAIstante('2026-09-01T10:30');

export function evento(over: Partial<EventWithRelations> = {}): EventWithRelations {
	return {
		id: ID_EVENTO,
		organizationId: ORG_ALTRA,
		venueId: 'v1',
		status: 'confirmed',
		title: 'Notte di Death Metal',
		subtitle: 'terza edizione',
		description: null,
		startsAt: daLocaleAIstante('2026-10-12T22:00'),
		endsAt: daLocaleAIstante('2026-10-13T02:00'),
		doorsAt: daLocaleAIstante('2026-10-12T21:00'),
		isMultiDay: false,
		city: 'Perugia',
		province: 'PG',
		region: 'Umbria',
		country: 'IT',
		lat: 43.1107,
		lon: 12.3908,
		conflictRadiusKm: null,
		isFree: false,
		isMembersOnly: true,
		pricePresale: '12.00',
		priceDoor: '15.00',
		currency: 'EUR',
		ticketUrl: 'https://biglietti.example/notte',
		ageRestriction: null,
		capacityExpected: null,
		posterUrl: null,
		facebookEventUrl: null,
		instagramPostUrl: null,
		externalUrl: null,
		announceAt: null,
		internalNotes: 'Cachet 800 €.',
		updatedAt: AGGIORNATO,
		segnalataDa: null,
		organization: {
			id: ORG_ALTRA,
			name: 'Associazione X',
			slug: 'associazione-x',
			city: 'Perugia',
			province: 'PG',
			emailContact: 'info@associazione-x.example',
			website: null,
			instagramUrl: null,
			facebookUrl: null,
			esterna: false
		},
		venue: {
			id: 'v1',
			name: 'Circolo Arci Il Grifo',
			address: 'Via dei Priori 3',
			city: 'Perugia',
			province: 'PG',
			lat: 43.1107,
			lon: 12.3908,
			capacity: 200
		},
		genres: [
			{ slug: 'death-metal', name: 'Death Metal', path: 'metal.death-metal', isPrimary: true },
			{ slug: 'grindcore', name: 'Grindcore', path: 'metal.grindcore', isPrimary: false }
		],
		lineup: [
			{
				id: 'l1',
				artistId: 'a1',
				nome: 'Nero Sabbia',
				billing: 'headliner',
				position: 0,
				stage: null,
				dayDate: null,
				setStartsAt: null,
				setDurationMinutes: null,
				isAnnounced: true
			},
			// La band che non deve uscire da nessuna delle tre porte.
			{
				id: 'l2',
				artistId: 'a2',
				nome: 'Ossario Lucente',
				billing: 'support',
				position: 1,
				stage: null,
				dayDate: null,
				setStartsAt: null,
				setDurationMinutes: null,
				isAnnounced: false
			}
		],
		links: [],
		...over
	};
}

/**
 * L'evento come lo vede un viewer. Solleva se non lo vede affatto: nei test
 * di questi tre moduli un `null` è sempre un errore della fixture, non un
 * caso da gestire.
 */
export function serializza(
	over: Partial<EventWithRelations>,
	viewer: ViewerContext
): EventoSerializzato {
	const s = serializeEvent(evento(over), viewer);
	if (!s) throw new Error('L’evento non è visibile a questo viewer.');
	return s;
}
