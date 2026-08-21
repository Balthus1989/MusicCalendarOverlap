/**
 * Redazione dei conflitti in uscita (ADR-0024, ADR-0009).
 *
 * È la suite che tiene insieme il motore e la promessa di ADR-0005. Il motore
 * rileva su dati completi — deve, altrimenti i conflitti comparirebbero e
 * sparirebbero a seconda di quale delle due date viene salvata per ultima — e
 * tutta la protezione si gioca qui, in uscita.
 *
 * Il caso che ADR-0009 chiama "rischio noto" e §15 chiama caso di test
 * obbligatorio è quello in fondo: **R2 non deve rivelare quale band**.
 */
import { describe, expect, it } from 'vitest';
import {
	redigiConflitto,
	serializeConflict,
	serializeEvent,
	type ConflittoGrezzo,
	type EventWithRelations,
	type ViewerContext
} from '../../src/lib/server/visibility';
import type { DettagliConflitto } from '../../src/lib/server/conflicts/rules';
import { daLocaleAIstante } from '../../src/lib/time';

const ORG_MIA = 'aaaaaaaa-0000-0000-0000-000000000000';
const ORG_ALTRA = 'bbbbbbbb-0000-0000-0000-000000000000';

const EVENTO_A = '11111111-0000-0000-0000-000000000000';
const EVENTO_B = '22222222-0000-0000-0000-000000000000';

const OPETH = 'cccccccc-0000-0000-0000-000000000000';
const ULVER = 'dddddddd-0000-0000-0000-000000000000';

const NOMI = { [OPETH]: 'Opeth', [ULVER]: 'Ulver' };

const venue = {
	id: 'eeeeeeee-0000-0000-0000-000000000000',
	name: 'Circolo Rurale',
	address: 'Via dei Tigli 4',
	city: 'Perugia',
	province: 'PG',
	lat: 43.1107,
	lon: 12.3908,
	capacity: 200
};

function organizzazione(id: string, name: string) {
	return {
		id,
		name,
		slug: name.toLowerCase().replace(/\s+/g, '-'),
		city: 'Perugia',
		province: 'PG',
		emailContact: `info@${name.toLowerCase().replace(/\s+/g, '')}.example`,
		website: null,
		instagramUrl: null,
		facebookUrl: null
	};
}

function evento(over: Partial<EventWithRelations> = {}): EventWithRelations {
	return {
		id: EVENTO_A,
		organizationId: ORG_MIA,
		venueId: venue.id,
		status: 'confirmed',
		title: 'Notte di Death Metal',
		subtitle: null,
		description: null,
		startsAt: daLocaleAIstante('2026-10-12T22:00'),
		endsAt: null,
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
		internalNotes: 'cachet 800',
		organization: organizzazione(ORG_MIA, 'Associazione Mia'),
		venue,
		genres: [
			{ slug: 'death-metal', name: 'Death Metal', path: 'metal.death-metal', isPrimary: true }
		],
		lineup: [],
		links: [],
		...over
	};
}

const viewer: ViewerContext = {
	profileId: 'ffffffff-0000-0000-0000-000000000000',
	organizationIds: [ORG_MIA],
	roles: { [ORG_MIA]: 'owner' },
	isPlatformAdmin: false
};

const estraneo: ViewerContext = {
	profileId: '99999999-0000-0000-0000-000000000000',
	organizationIds: ['cccc0000-0000-0000-0000-000000000000'],
	roles: { 'cccc0000-0000-0000-0000-000000000000': 'member' },
	isPlatformAdmin: false
};

function conflitto(over: Partial<ConflittoGrezzo> = {}): ConflittoGrezzo {
	return {
		id: 'dddd0000-0000-0000-0000-000000000000',
		eventAId: EVENTO_A,
		eventBId: EVENTO_B,
		kind: 'geo_genre_overlap',
		severity: 'medium',
		status: 'open',
		distanceKm: '12.5',
		genreAffinity: '0.80',
		daysApart: 0,
		details: {},
		acknowledgedByA: false,
		acknowledgedByB: false,
		resolutionNote: null,
		computedAt: new Date(),
		updatedAt: new Date(),
		...over
	};
}

/** Le due date del conflitto: la mia (A) e quella dell'altra organizzazione (B). */
function coppia(statoAltrui: EventWithRelations['status'] = 'confirmed') {
	return {
		a: evento({ id: EVENTO_A, organizationId: ORG_MIA }),
		b: evento({
			id: EVENTO_B,
			organizationId: ORG_ALTRA,
			status: statoAltrui,
			title: 'Serata segreta',
			organization: organizzazione(ORG_ALTRA, 'Associazione Altra'),
			internalNotes: 'accordo riservato'
		})
	};
}

describe('chi può vedere un conflitto', () => {
	it('lo vede chi è membro di una delle due organizzazioni', () => {
		const c = serializeConflict(conflitto(), coppia(), viewer, NOMI);
		expect(c).not.toBeNull();
		expect(c?.mia.id).toBe(EVENTO_A);
		expect(c?.controparte.id).toBe(EVENTO_B);
	});

	it('non lo vede un estraneo a entrambe', () => {
		// Che due date si diano fastidio non è un'informazione del calendario:
		// è una conversazione fra due persone.
		expect(serializeConflict(conflitto(), coppia(), estraneo, NOMI)).toBeNull();
	});

	it('la propria data esce sempre in visibilità completa', () => {
		const c = serializeConflict(conflitto(), coppia(), viewer, NOMI);
		expect(c?.mia.visibilita).toBe('completa');
		expect(c?.mia.internalNotes).toBe('cachet 800');
	});

	it('la controparte in `hold` esce ridotta, con le note interne fuori', () => {
		const c = serializeConflict(conflitto(), coppia('hold'), viewer, NOMI);
		expect(c?.controparte.visibilita).toBe('ridotta');
		expect(c?.controparte).not.toHaveProperty('title');
		expect(c?.controparte).not.toHaveProperty('internalNotes');
	});
});

describe('R1 — il conflitto di locale non esce se il locale è riservato', () => {
	it('con la controparte confermata si vede, e si vede quale locale', () => {
		const c = serializeConflict(
			conflitto({ kind: 'venue_clash', severity: 'high', details: { venueId: venue.id } }),
			coppia('confirmed'),
			viewer,
			NOMI
		);
		expect(c?.venue?.name).toBe('Circolo Rurale');
	});

	it('con la controparte opzionata non si vede affatto', () => {
		// Un conflitto di locale *è* il locale: chi lo riceve conosce il
		// proprio, quindi dedurrebbe l'altro. Non c'è modo di raccontarlo a
		// metà, e il locale di un `hold` è riservato (ADR-0005).
		const c = serializeConflict(
			conflitto({ kind: 'venue_clash', severity: 'high', details: { venueId: venue.id } }),
			coppia('hold'),
			viewer,
			NOMI
		);
		expect(c).toBeNull();
	});
});

describe('R2 — non rivelare quale band (ADR-0009, caso di test obbligatorio)', () => {
	const dettagliCon = (artisti: DettagliConflitto['artisti']): DettagliConflitto => ({ artisti });

	function conflittoArtisti(artisti: DettagliConflitto['artisti']) {
		return conflitto({
			kind: 'artist_overlap',
			severity: 'high',
			daysApart: 0,
			details: dettagliCon(artisti)
		});
	}

	it('band annunciata da entrambi: si nomina', () => {
		const c = serializeConflict(
			conflittoArtisti([{ artistId: OPETH, annunciatoA: true, annunciatoB: true }]),
			coppia('confirmed'),
			viewer,
			NOMI
		);
		expect(c?.artisti).toEqual([{ id: OPETH, nome: 'Opeth' }]);
	});

	it('band annunciata solo dalla controparte: si nomina', () => {
		// Il nome è già pubblico da quella parte: dirlo non rivela niente che
		// la controparte non abbia già annunciato per conto suo.
		const c = serializeConflict(
			conflittoArtisti([{ artistId: OPETH, annunciatoA: false, annunciatoB: true }]),
			coppia('hold'),
			viewer,
			NOMI
		);
		expect(c?.artisti).toEqual([{ id: OPETH, nome: 'Opeth' }]);
	});

	it('band annunciata solo da me: il conflitto non mi viene mostrato affatto', () => {
		// **Questo è il caso che protegge ADR-0005.** Se lo vedessi, saprei
		// che l'altra organizzazione ha ingaggiato una band che non ha ancora
		// annunciato — cioè esattamente il segreto per cui `hold` esiste. Non
		// basta togliere il nome: conosco la mia lineup, quindi il nome lo
		// dedurrei da solo.
		const c = serializeConflict(
			conflittoArtisti([{ artistId: OPETH, annunciatoA: true, annunciatoB: false }]),
			coppia('hold'),
			viewer,
			NOMI
		);
		expect(c).toBeNull();
	});

	it('nemmeno il *numero* di band condivise trapela', () => {
		// Tre band in comune di cui una sola annunciata dalla controparte: se
		// il conflitto dicesse "tre", saprei che le altre due segrete sono
		// mie, e quindi quali sono.
		const c = serializeConflict(
			conflittoArtisti([
				{ artistId: OPETH, annunciatoA: true, annunciatoB: true },
				{ artistId: ULVER, annunciatoA: true, annunciatoB: false },
				{ artistId: 'aaaa1111-0000-0000-0000-000000000000', annunciatoA: true, annunciatoB: false }
			]),
			coppia('hold'),
			viewer,
			NOMI
		);
		expect(c?.artisti).toEqual([{ id: OPETH, nome: 'Opeth' }]);
	});

	it('lo stesso conflitto si racconta diversamente ai due lati', () => {
		// Il motore ha registrato una riga sola. Il lato che ha annunciato la
		// band non deve vedere niente; l'altro sì. È la ragione per cui la
		// redazione sta in uscita e non nel motore (ADR-0024).
		const righe = conflittoArtisti([{ artistId: OPETH, annunciatoA: true, annunciatoB: false }]);
		const eventi = coppia('hold');

		const daA = serializeConflict(righe, eventi, viewer, NOMI);

		const viewerB: ViewerContext = {
			profileId: '88888888-0000-0000-0000-000000000000',
			organizationIds: [ORG_ALTRA],
			roles: { [ORG_ALTRA]: 'owner' },
			isPlatformAdmin: false
		};
		const daB = serializeConflict(righe, eventi, viewerB, NOMI);

		expect(daA).toBeNull();
		expect(daB?.artisti).toEqual([{ id: OPETH, nome: 'Opeth' }]);
	});

	it('una band non in anagrafica non fa saltare la serializzazione', () => {
		const c = serializeConflict(
			conflittoArtisti([{ artistId: OPETH, annunciatoA: false, annunciatoB: true }]),
			coppia('confirmed'),
			viewer,
			{}
		);
		expect(c?.artisti[0].nome).toBe('Band non in anagrafica');
	});
});

describe('R3 e R4 — l’affinità non racconta i generi secondari altrui', () => {
	it('con la controparte confermata l’affinità esce', () => {
		const c = serializeConflict(conflitto(), coppia('confirmed'), viewer, NOMI);
		expect(c?.affinita).toBe(0.8);
	});

	it('con la controparte opzionata l’affinità resta dentro', () => {
		// È calcolata anche sui generi secondari, che in `hold` sono
		// riservati: il numero da solo permetterebbe di indovinarli.
		const c = serializeConflict(conflitto(), coppia('hold'), viewer, NOMI);
		expect(c?.affinita).toBeNull();
		// Il conflitto però si vede: giorno, città e genere primario sono
		// quello che `hold` mostra apposta, ed è ciò che fa scattare la
		// telefonata.
		expect(c).not.toBeNull();
	});
});

describe('stato della conversazione', () => {
	it('distingue il proprio "preso atto" da quello della controparte', () => {
		const c = serializeConflict(
			conflitto({ acknowledgedByA: true, acknowledgedByB: false }),
			coppia(),
			viewer,
			NOMI
		);
		expect(c?.presoAtto).toBe(true);
		expect(c?.presoAttoDallAltro).toBe(false);
	});

	it('i due lati si invertono guardando dall’altra parte', () => {
		const viewerB: ViewerContext = {
			profileId: '88888888-0000-0000-0000-000000000000',
			organizationIds: [ORG_ALTRA],
			roles: { [ORG_ALTRA]: 'member' },
			isPlatformAdmin: false
		};
		const c = serializeConflict(
			conflitto({ acknowledgedByA: true, acknowledgedByB: false }),
			coppia(),
			viewerB,
			NOMI
		);
		expect(c?.presoAtto).toBe(false);
		expect(c?.presoAttoDallAltro).toBe(true);
	});
});

describe('redigiConflitto, usata anche dall’anteprima nel form', () => {
	it('applica le stesse regole senza bisogno di una riga nel database', () => {
		// L'anteprima lavora su conflitti non ancora persistiti: se usasse una
		// redazione diversa, l'avviso mostrato mentre si compila non sarebbe
		// quello che poi arriva in dashboard.
		const controparte = serializeEvent(coppia('hold').b, viewer);
		expect(controparte).not.toBeNull();

		const nascosto = redigiConflitto(
			'artist_overlap',
			{ artisti: [{ artistId: OPETH, annunciatoA: true, annunciatoB: false }] },
			null,
			controparte!,
			true,
			NOMI
		);
		expect(nascosto).toBeNull();

		const visibile = redigiConflitto(
			'artist_overlap',
			{ artisti: [{ artistId: OPETH, annunciatoA: false, annunciatoB: true }] },
			null,
			controparte!,
			true,
			NOMI
		);
		expect(visibile?.artisti).toEqual([{ id: OPETH, nome: 'Opeth' }]);
	});
});
