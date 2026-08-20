import { describe, expect, it } from 'vitest';
import {
	allargaLaVisibilita,
	descriviTransizione,
	motiviCheImpediscono,
	puoTransire,
	transizioniAmmesse,
	TRANSIZIONI
} from '../../src/lib/server/events/status';
import type { EventStatus } from '../../src/lib/server/db/schema';

const STATI: EventStatus[] = ['draft', 'hold', 'confirmed', 'cancelled'];

const evento = (over: Partial<Parameters<typeof motiviCheImpediscono>[1]> = {}) => ({
	title: 'Notte di Death Metal',
	city: 'Perugia',
	venueId: 'v1',
	startsAt: new Date('2026-10-12T20:00:00.000Z'),
	...over
});

describe('transizioni', () => {
	it('restare nello stesso stato è sempre ammesso', () => {
		for (const s of STATI) expect(puoTransire(s, s)).toBe(true);
	});

	it('dalla bozza si va ovunque', () => {
		expect(transizioniAmmesse('draft')).toEqual(['hold', 'confirmed', 'cancelled']);
	});

	it('non si torna MAI in bozza', () => {
		// È la regola che rende `draft` un’affermazione affidabile: nessun altro
		// l’ha mai visto. Un ritorno indietro la renderebbe una bugia.
		for (const s of STATI) {
			if (s === 'draft') continue;
			expect(puoTransire(s, 'draft')).toBe(false);
		}
	});

	it('un hold si annuncia o si annulla', () => {
		expect(puoTransire('hold', 'confirmed')).toBe(true);
		expect(puoTransire('hold', 'cancelled')).toBe(true);
	});

	it('una data confermata può rientrare in hold: l’annuncio ritirato esiste', () => {
		expect(puoTransire('confirmed', 'hold')).toBe(true);
	});

	it('una data annullata può tornare in vita', () => {
		expect(puoTransire('cancelled', 'hold')).toBe(true);
		expect(puoTransire('cancelled', 'confirmed')).toBe(true);
	});

	it('ogni stato dichiara solo stati esistenti', () => {
		for (const s of STATI) {
			for (const d of TRANSIZIONI[s]) expect(STATI).toContain(d);
			expect(TRANSIZIONI[s]).not.toContain(s);
		}
	});
});

describe('requisiti di stato', () => {
	it('un evento completo non ha nulla che lo blocchi', () => {
		for (const s of STATI) expect(motiviCheImpediscono(s, evento())).toEqual([]);
	});

	it('confermare senza locale è bloccato', () => {
		const motivi = motiviCheImpediscono('confirmed', evento({ venueId: null }));
		expect(motivi.map((m) => m.campo)).toEqual(['venueId']);
	});

	it('opzionare senza locale invece si può: è il caso che dà senso a hold', () => {
		expect(motiviCheImpediscono('hold', evento({ venueId: null }))).toEqual([]);
		expect(motiviCheImpediscono('draft', evento({ venueId: null }))).toEqual([]);
	});

	it('la città serve sempre: senza, l’evento è invisibile al motore conflitti', () => {
		const motivi = motiviCheImpediscono('hold', evento({ city: '   ' }));
		expect(motivi.map((m) => m.campo)).toContain('city');
	});

	it('titolo e data mancanti bloccano qualunque stato', () => {
		const motivi = motiviCheImpediscono('draft', evento({ title: '', startsAt: null }));
		expect(motivi.map((m) => m.campo).sort()).toEqual(['startsAt', 'title']);
	});
});

describe('avvisi all’interfaccia', () => {
	it('riconosce i passaggi che allargano la visibilità', () => {
		expect(allargaLaVisibilita('draft', 'hold')).toBe(true);
		expect(allargaLaVisibilita('hold', 'confirmed')).toBe(true);
		expect(allargaLaVisibilita('confirmed', 'hold')).toBe(false);
	});

	it('descrive la transizione in italiano leggibile', () => {
		expect(descriviTransizione('hold', 'confirmed')).toBe('Opzionata → Confermata');
	});
});
