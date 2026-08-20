/**
 * Il calendario è l'ultimo passaggio prima dello schermo, ed è il punto in cui
 * un dato ridotto potrebbe tornare a essere completo per distrazione: basta
 * riempire un campo `start` con un orario che la serializzazione aveva tolto.
 */
import { describe, expect, it } from 'vitest';
import { aEventoCalendario } from '../../src/lib/server/events/calendar';
import { serializeEvent, type EventWithRelations } from '../../src/lib/server/visibility';
import type { ViewerContext } from '../../src/lib/server/visibility';
import { daLocaleAIstante } from '../../src/lib/time';

const ORG_MIA = 'aaaaaaaa-0000-0000-0000-000000000000';
const ORG_ALTRA = 'bbbbbbbb-0000-0000-0000-000000000000';

const estraneo: ViewerContext = {
	profileId: 'p1',
	organizationIds: [ORG_MIA],
	roles: { [ORG_MIA]: 'owner' },
	isPlatformAdmin: false
};

const membro: ViewerContext = {
	profileId: 'p2',
	organizationIds: [ORG_ALTRA],
	roles: { [ORG_ALTRA]: 'member' },
	isPlatformAdmin: false
};

function evento(over: Partial<EventWithRelations> = {}): EventWithRelations {
	return {
		id: 'e1',
		organizationId: ORG_ALTRA,
		venueId: 'v1',
		status: 'confirmed',
		title: 'Notte di Death Metal',
		subtitle: null,
		description: null,
		startsAt: daLocaleAIstante('2026-10-12T22:00'),
		endsAt: daLocaleAIstante('2026-10-13T02:00'),
		doorsAt: null,
		isMultiDay: false,
		city: 'Perugia',
		province: 'PG',
		region: 'Umbria',
		country: 'IT',
		lat: 43.1107,
		lon: 12.3908,
		conflictRadiusKm: null,
		isFree: false,
		isMembersOnly: false,
		pricePresale: null,
		priceDoor: null,
		currency: 'EUR',
		ticketUrl: null,
		ageRestriction: null,
		capacityExpected: null,
		posterUrl: null,
		facebookEventUrl: null,
		instagramPostUrl: null,
		externalUrl: null,
		announceAt: null,
		internalNotes: 'Cachet 800 €.',
		organization: {
			id: ORG_ALTRA,
			name: 'Associazione X',
			slug: 'associazione-x',
			city: 'Perugia',
			province: 'PG',
			emailContact: 'info@associazione-x.example',
			website: null,
			instagramUrl: null,
			facebookUrl: null
		},
		venue: {
			id: 'v1',
			name: 'Circolo Rurale',
			address: null,
			city: 'Perugia',
			province: 'PG',
			lat: 43.1107,
			lon: 12.3908,
			capacity: 200
		},
		genres: [{ slug: 'metal', name: 'Metal', path: 'metal', isPrimary: true }],
		lineup: [],
		links: [],
		...over
	};
}

const perCalendario = (e: EventWithRelations, viewer: ViewerContext) => {
	const serializzato = serializeEvent(e, viewer);
	expect(serializzato).not.toBeNull();
	return aEventoCalendario(serializzato!);
};

describe('un hold altrui in calendario', () => {
	const voce = perCalendario(evento({ status: 'hold' }), estraneo);

	it('occupa la giornata, non un orario', () => {
		expect(voce.allDay).toBe(true);
		expect(voce.start).toBe('2026-10-12');
		expect(voce.end).toBeUndefined();
	});

	it('non porta con sé nessun orario, nemmeno negli attributi accessori', () => {
		expect(JSON.stringify(voce)).not.toContain('T20:00');
		expect(voce.extendedProps.ora).toBeNull();
	});

	it('si presenta come genere più organizzazione', () => {
		expect(voce.title).toBe('Metal · Associazione X');
		expect(voce.title).not.toContain('Notte');
	});

	it('non nomina il locale', () => {
		expect(voce.extendedProps.locale).toBeNull();
		expect(JSON.stringify(voce)).not.toContain('Circolo Rurale');
	});

	it('dice come contattare chi lo organizza: è il motivo per cui è lì', () => {
		expect(voce.extendedProps.organizzazione).toBe('Associazione X');
		expect(voce.extendedProps.organizzazioneEmail).toBe('info@associazione-x.example');
	});

	it('si distingue a vista senza affidarsi al solo colore', () => {
		expect(voce.classNames).toContain('evento--hold');
		expect(voce.classNames).toContain('evento--ridotto');
		expect(voce.classNames).toContain('evento--altrui');
	});
});

describe('una data confermata in calendario', () => {
	const voce = perCalendario(evento(), estraneo);

	it('ha orario di inizio e di fine', () => {
		expect(voce.allDay).toBe(false);
		expect(voce.start).toBe(daLocaleAIstante('2026-10-12T22:00').toISOString());
		expect(voce.end).toBe(daLocaleAIstante('2026-10-13T02:00').toISOString());
	});

	it('mostra l’ora di parete italiana, non quella del browser di chi guarda', () => {
		expect(voce.extendedProps.ora).toBe('22:00');
	});

	it('porta il titolo vero e il locale', () => {
		expect(voce.title).toBe('Notte di Death Metal');
		expect(voce.extendedProps.locale).toBe('Circolo Rurale');
	});
});

describe('le proprie date in calendario', () => {
	it('una bozza propria si vede, e si riconosce dallo stile', () => {
		const voce = perCalendario(evento({ status: 'draft' }), membro);
		expect(voce.classNames).toContain('evento--draft');
		expect(voce.classNames).toContain('evento--proprio');
		expect(voce.title).toBe('Notte di Death Metal');
	});

	it('nemmeno le proprie note interne finiscono nel payload del calendario', () => {
		// Non è una questione di visibilità ma di superficie: il calendario è
		// l'unico endpoint che restituisce molte date insieme, e non ha motivo
		// di trasportare campi che nessuno disegna.
		const voce = perCalendario(evento({ status: 'draft' }), membro);
		expect(JSON.stringify(voce)).not.toContain('Cachet');
	});
});
