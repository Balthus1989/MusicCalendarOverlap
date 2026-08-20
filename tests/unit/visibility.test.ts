/**
 * La suite più importante del progetto (ARCHITECTURE.md §15).
 *
 * Una asserzione per ogni cella della matrice di §5: righe = campo, colonne =
 * stato dell'evento visto da un'altra organizzazione, più la colonna "propria
 * organizzazione". Se una cella qui è sbagliata, un organizzatore si vede
 * bruciare un annuncio — che è l'unico modo in cui questo prodotto può fare
 * un danno reale.
 */
import { describe, expect, it } from 'vitest';
import { daLocaleAIstante } from '../../src/lib/time';
import {
	serializeEvent,
	serializeEvents,
	titoloVisibile,
	type EventWithRelations,
	type EventoCompleto,
	type EventoRidotto,
	type ViewerContext
} from '../../src/lib/server/visibility';
import type { EventStatus } from '../../src/lib/server/db/schema';

const ORG_MIA = 'aaaaaaaa-0000-0000-0000-000000000000';
const ORG_ALTRA = 'bbbbbbbb-0000-0000-0000-000000000000';

const organizzazione = {
	id: ORG_ALTRA,
	name: 'Associazione X',
	slug: 'associazione-x',
	city: 'Perugia',
	province: 'PG',
	emailContact: 'info@associazione-x.example',
	website: 'https://associazione-x.example',
	instagramUrl: null,
	facebookUrl: null
};

const venue = {
	id: 'cccccccc-0000-0000-0000-000000000000',
	name: 'Circolo Rurale',
	address: 'Via dei Tigli 4',
	city: 'Perugia',
	province: 'PG',
	lat: 43.1107,
	lon: 12.3908,
	capacity: 200
};

const metal = { slug: 'metal', name: 'Metal', path: 'metal', isPrimary: true };
const deathMetal = {
	slug: 'death-metal',
	name: 'Death Metal',
	path: 'metal.death-metal',
	isPrimary: false
};

/** Un evento con tutti i campi valorizzati: ogni cella della matrice ha di che sbagliare. */
function evento(over: Partial<EventWithRelations> = {}): EventWithRelations {
	return {
		id: 'eeeeeeee-0000-0000-0000-000000000000',
		organizationId: ORG_ALTRA,
		venueId: venue.id,
		status: 'confirmed',
		title: 'Notte di Death Metal',
		subtitle: 'terza edizione',
		description: 'Una serata **rumorosa**.',
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
		conflictRadiusKm: 45,
		isFree: false,
		isMembersOnly: true,
		pricePresale: '12.00',
		priceDoor: '15.00',
		currency: 'EUR',
		ticketUrl: 'https://tickets.example/notte',
		ageRestriction: '18+',
		capacityExpected: 180,
		posterUrl: 'https://storage.example/locandina.jpg',
		facebookEventUrl: 'https://facebook.example/eventi/1',
		instagramPostUrl: null,
		externalUrl: null,
		announceAt: daLocaleAIstante('2026-09-01T09:00'),
		internalNotes: 'Cachet 800 €, pagamento in contanti.',
		organization: organizzazione,
		venue,
		genres: [metal, deathMetal],
		lineup: [
			{
				id: 'l1',
				artistId: 'a1',
				nome: 'Opeth',
				billing: 'headliner',
				position: 0,
				stage: null,
				dayDate: null,
				setStartsAt: daLocaleAIstante('2026-10-12T23:00'),
				setDurationMinutes: 90,
				isAnnounced: true
			},
			{
				id: 'l2',
				artistId: 'a2',
				nome: 'Band Segreta',
				billing: 'support',
				position: 1,
				stage: null,
				dayDate: null,
				setStartsAt: null,
				setDurationMinutes: null,
				isAnnounced: false
			}
		],
		links: [{ label: 'Bandcamp', url: 'https://bandcamp.example/notte' }],
		...over
	};
}

const estraneo: ViewerContext = {
	profileId: 'p-estraneo',
	organizationIds: [ORG_MIA],
	roles: { [ORG_MIA]: 'owner' },
	isPlatformAdmin: false
};

const membro: ViewerContext = {
	profileId: 'p-membro',
	organizationIds: [ORG_ALTRA],
	roles: { [ORG_ALTRA]: 'member' },
	isPlatformAdmin: false
};

const STATI: EventStatus[] = ['draft', 'hold', 'confirmed', 'cancelled'];

/** Serializza per un estraneo, con lo stato dato. */
const perEstraneo = (status: EventStatus) => serializeEvent(evento({ status }), estraneo);
/** Serializza per un membro dell'organizzazione proprietaria. */
const perMembro = (status: EventStatus) => serializeEvent(evento({ status }), membro);

const completo = (r: ReturnType<typeof serializeEvent>): EventoCompleto => {
	expect(r?.visibilita).toBe('completa');
	return r as EventoCompleto;
};
const ridotto = (r: ReturnType<typeof serializeEvent>): EventoRidotto => {
	expect(r?.visibilita).toBe('ridotta');
	return r as EventoRidotto;
};

/* ------------------------------------------------------------------ *
 * Matrice §5, riga per riga
 * ------------------------------------------------------------------ */

describe('esistenza dell’evento', () => {
	it('la bozza altrui non esiste', () => {
		expect(perEstraneo('draft')).toBeNull();
	});

	it('hold, confirmed e cancelled altrui esistono', () => {
		expect(perEstraneo('hold')).not.toBeNull();
		expect(perEstraneo('confirmed')).not.toBeNull();
		expect(perEstraneo('cancelled')).not.toBeNull();
	});

	it('per la propria organizzazione esiste in ogni stato', () => {
		for (const s of STATI) expect(perMembro(s)).not.toBeNull();
	});

	it('l’annullato resta visibile: libera uno slot, ed è un’informazione utile', () => {
		expect(completo(perEstraneo('cancelled')).status).toBe('cancelled');
	});
});

describe('data (giorno)', () => {
	it('è visibile in hold, confirmed e cancelled altrui', () => {
		expect(perEstraneo('hold')?.giorno).toBe('2026-10-12');
		expect(perEstraneo('confirmed')?.giorno).toBe('2026-10-12');
		expect(perEstraneo('cancelled')?.giorno).toBe('2026-10-12');
	});

	it('è il giorno civile in Europe/Rome, non quello UTC', () => {
		// 00:30 del 13 ottobre a Roma sono le 22:30 del 12 in UTC: chi legge
		// l’istante grezzo sbaglia giorno, e con il giorno sbaglia il conflitto.
		const notturno = evento({ status: 'hold', startsAt: daLocaleAIstante('2026-10-13T00:30') });
		expect(serializeEvent(notturno, estraneo)?.giorno).toBe('2026-10-13');
	});

	it('è visibile alla propria organizzazione in ogni stato', () => {
		for (const s of STATI) expect(perMembro(s)?.giorno).toBe('2026-10-12');
	});
});

describe('ora esatta', () => {
	it('NON esce da un hold altrui', () => {
		const r = ridotto(perEstraneo('hold'));
		expect(r).not.toHaveProperty('startsAt');
		expect(r).not.toHaveProperty('doorsAt');
		expect(JSON.stringify(r)).not.toContain('T20:00');
	});

	it('esce da confirmed e cancelled altrui', () => {
		expect(completo(perEstraneo('confirmed')).startsAt).toEqual(
			daLocaleAIstante('2026-10-12T22:00')
		);
		expect(completo(perEstraneo('cancelled')).startsAt).toEqual(
			daLocaleAIstante('2026-10-12T22:00')
		);
	});

	it('esce sempre dentro la propria organizzazione', () => {
		for (const s of STATI) {
			expect(completo(perMembro(s)).startsAt).toEqual(daLocaleAIstante('2026-10-12T22:00'));
		}
	});
});

describe('città e provincia', () => {
	it('sono visibili in hold, confirmed e cancelled altrui', () => {
		for (const s of ['hold', 'confirmed', 'cancelled'] as const) {
			expect(perEstraneo(s)?.city).toBe('Perugia');
			expect(perEstraneo(s)?.province).toBe('PG');
		}
	});

	it('sono visibili alla propria organizzazione in ogni stato', () => {
		for (const s of STATI) expect(perMembro(s)?.city).toBe('Perugia');
	});
});

describe('venue', () => {
	it('NON esce da un hold altrui', () => {
		const r = ridotto(perEstraneo('hold'));
		expect(r).not.toHaveProperty('venue');
		expect(JSON.stringify(r)).not.toContain('Circolo Rurale');
	});

	it('esce da confirmed e cancelled altrui', () => {
		expect(completo(perEstraneo('confirmed')).venue?.name).toBe('Circolo Rurale');
		expect(completo(perEstraneo('cancelled')).venue?.name).toBe('Circolo Rurale');
	});

	it('esce sempre dentro la propria organizzazione', () => {
		for (const s of STATI) expect(completo(perMembro(s)).venue?.name).toBe('Circolo Rurale');
	});
});

describe('titolo', () => {
	it('NON esce da un hold altrui', () => {
		expect(JSON.stringify(ridotto(perEstraneo('hold')))).not.toContain('Notte di Death Metal');
	});

	it('esce da confirmed e cancelled altrui', () => {
		expect(completo(perEstraneo('confirmed')).title).toBe('Notte di Death Metal');
		expect(completo(perEstraneo('cancelled')).title).toBe('Notte di Death Metal');
	});

	it('esce sempre dentro la propria organizzazione', () => {
		for (const s of STATI) expect(completo(perMembro(s)).title).toBe('Notte di Death Metal');
	});

	it('in hold altrui l’etichetta è genere più organizzazione, mai il titolo', () => {
		const r = perEstraneo('hold')!;
		expect(titoloVisibile(r)).toBe('Metal · Associazione X');
	});
});

describe('generi', () => {
	it('in hold altrui esce il primario e basta', () => {
		const r = ridotto(perEstraneo('hold'));
		expect(r.generePrimario?.slug).toBe('metal');
		expect(JSON.stringify(r)).not.toContain('death-metal');
	});

	it('in hold altrui senza genere primario non inventa nulla', () => {
		const senzaPrimario = evento({ status: 'hold', genres: [{ ...deathMetal }] });
		expect(ridotto(serializeEvent(senzaPrimario, estraneo)).generePrimario).toBeNull();
	});

	it('i secondari escono da confirmed e cancelled altrui', () => {
		for (const s of ['confirmed', 'cancelled'] as const) {
			expect(completo(perEstraneo(s)).generi.map((g) => g.slug)).toEqual(['metal', 'death-metal']);
		}
	});

	it('escono tutti dentro la propria organizzazione, in ogni stato', () => {
		for (const s of STATI) {
			expect(completo(perMembro(s)).generi.map((g) => g.slug)).toEqual(['metal', 'death-metal']);
		}
	});
});

describe('lineup', () => {
	it('NON esce da un hold altrui, in nessuna forma', () => {
		const r = ridotto(perEstraneo('hold'));
		expect(r).not.toHaveProperty('lineup');
		expect(JSON.stringify(r)).not.toContain('Opeth');
		expect(JSON.stringify(r)).not.toContain('Band Segreta');
	});

	it('da un confirmed altrui escono solo le voci annunciate', () => {
		const l = completo(perEstraneo('confirmed')).lineup;
		expect(l.map((v) => v.nome)).toEqual(['Opeth']);
	});

	it('da un cancelled altrui escono solo le voci annunciate', () => {
		// La matrice di §5 segna la cella come pienamente visibile, ma un hold
		// annullato esporrebbe di colpo una lineup mai annunciata. Qui il
		// prodotto vale più della tabella.
		const l = completo(perEstraneo('cancelled')).lineup;
		expect(l.map((v) => v.nome)).toEqual(['Opeth']);
	});

	it('dentro la propria organizzazione esce tutta, annunciata o no', () => {
		for (const s of STATI) {
			expect(completo(perMembro(s)).lineup.map((v) => v.nome)).toEqual(['Opeth', 'Band Segreta']);
		}
	});

	it('una band non annunciata non esce mai, per nessuno stato e nessun estraneo', () => {
		// È la precondizione del rischio noto di ADR-0009: se la lineup segreta
		// non esce di qui, la regola R2 di Fase 3 non ha nulla da rivelare.
		for (const s of STATI) {
			const r = perEstraneo(s);
			expect(JSON.stringify(r ?? null)).not.toContain('Band Segreta');
		}
	});
});

describe('locandina, prezzi e ticket', () => {
	it('NON escono da un hold altrui', () => {
		const r = ridotto(perEstraneo('hold'));
		const testo = JSON.stringify(r);
		expect(testo).not.toContain('locandina.jpg');
		expect(testo).not.toContain('12.00');
		expect(testo).not.toContain('tickets.example');
	});

	it('escono da confirmed e cancelled altrui', () => {
		for (const s of ['confirmed', 'cancelled'] as const) {
			const c = completo(perEstraneo(s));
			expect(c.posterUrl).toBe('https://storage.example/locandina.jpg');
			expect(c.pricePresale).toBe('12.00');
			expect(c.priceDoor).toBe('15.00');
			expect(c.ticketUrl).toBe('https://tickets.example/notte');
		}
	});

	it('escono sempre dentro la propria organizzazione', () => {
		for (const s of STATI) expect(completo(perMembro(s)).pricePresale).toBe('12.00');
	});
});

describe('organizzazione e contatto', () => {
	it('escono in hold, confirmed e cancelled altrui: sono ciò che fa scattare la telefonata', () => {
		for (const s of ['hold', 'confirmed', 'cancelled'] as const) {
			const r = perEstraneo(s)!;
			expect(r.organizzazione.name).toBe('Associazione X');
			expect(r.organizzazione.emailContact).toBe('info@associazione-x.example');
		}
	});

	it('escono anche dentro la propria organizzazione', () => {
		for (const s of STATI) expect(perMembro(s)?.organizzazione.name).toBe('Associazione X');
	});
});

describe('internal_notes', () => {
	it('non escono MAI da un’altra organizzazione, in nessuno stato', () => {
		for (const s of STATI) {
			const r = perEstraneo(s);
			expect(JSON.stringify(r ?? null)).not.toContain('Cachet');
		}
		expect(completo(perEstraneo('confirmed')).internalNotes).toBeNull();
		expect(completo(perEstraneo('cancelled')).internalNotes).toBeNull();
	});

	it('escono solo dentro la propria organizzazione', () => {
		for (const s of STATI) {
			expect(completo(perMembro(s)).internalNotes).toBe('Cachet 800 €, pagamento in contanti.');
		}
	});
});

describe('announce_at', () => {
	it('non esce mai da un’altra organizzazione', () => {
		for (const s of STATI) {
			const r = perEstraneo(s);
			if (r?.visibilita === 'completa') expect(r.announceAt).toBeNull();
			expect(JSON.stringify(r ?? null)).not.toContain('2026-09-01');
		}
	});

	it('esce dentro la propria organizzazione', () => {
		expect(completo(perMembro('hold')).announceAt).toEqual(daLocaleAIstante('2026-09-01T09:00'));
	});
});

/* ------------------------------------------------------------------ *
 * Casi che la matrice non copre ma che possono fare danno lo stesso
 * ------------------------------------------------------------------ */

describe('chi è "proprio"', () => {
	it('vale per qualunque ruolo: anche il member vede tutto della sua organizzazione', () => {
		expect(completo(perMembro('draft')).internalNotes).not.toBeNull();
	});

	it('vale per tutte le organizzazioni del profilo, non solo per una', () => {
		const doppio: ViewerContext = {
			profileId: 'p-doppio',
			organizationIds: [ORG_MIA, ORG_ALTRA],
			roles: { [ORG_MIA]: 'owner', [ORG_ALTRA]: 'member' },
			isPlatformAdmin: false
		};
		expect(serializeEvent(evento({ status: 'draft' }), doppio)).not.toBeNull();
	});

	it('un profilo senza organizzazioni è un estraneo per tutti', () => {
		const orfano: ViewerContext = {
			profileId: 'p-orfano',
			organizationIds: [],
			roles: {},
			isPlatformAdmin: false
		};
		expect(serializeEvent(evento({ status: 'draft' }), orfano)).toBeNull();
		expect(serializeEvent(evento({ status: 'hold' }), orfano)?.visibilita).toBe('ridotta');
	});
});

describe('il platform admin non è un lettore privilegiato', () => {
	// Se il manutentore vedesse le bozze e le lineup di tutti, ADR-0005
	// proteggerebbe dai concorrenti e non da chi amministra: non è ciò che si
	// è promesso agli organizzatori.
	const admin: ViewerContext = {
		profileId: 'p-admin',
		organizationIds: [],
		roles: {},
		isPlatformAdmin: true
	};

	it('non vede le bozze altrui', () => {
		expect(serializeEvent(evento({ status: 'draft' }), admin)).toBeNull();
	});

	it('vede un hold altrui esattamente come chiunque altro', () => {
		const r = serializeEvent(evento({ status: 'hold' }), admin);
		expect(r?.visibilita).toBe('ridotta');
		expect(JSON.stringify(r)).not.toContain('Band Segreta');
	});

	it('non vede le note interne altrui', () => {
		const r = serializeEvent(evento({ status: 'confirmed' }), admin);
		expect(completo(r).internalNotes).toBeNull();
	});
});

describe('serializzazione di una lista', () => {
	it('scarta le bozze altrui invece di lasciare dei buchi', () => {
		const lista = [
			evento({ id: 'e1', status: 'draft' }),
			evento({ id: 'e2', status: 'hold' }),
			evento({ id: 'e3', status: 'confirmed' })
		];
		const esito = serializeEvents(lista, estraneo);
		expect(esito.map((e) => e.id)).toEqual(['e2', 'e3']);
	});

	it('non scarta nulla dentro la propria organizzazione', () => {
		const lista = STATI.map((s, i) => evento({ id: `e${i}`, status: s }));
		expect(serializeEvents(lista, membro)).toHaveLength(4);
	});
});
