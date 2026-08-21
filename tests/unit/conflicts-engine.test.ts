/**
 * Il motore: ordinamento della coppia, applicazione delle quattro regole,
 * confronto con un elenco di candidati (ARCHITECTURE.md §6).
 */
import { describe, expect, it } from 'vitest';
import {
	conflittiFraEventi,
	meritaNotifica,
	ordinaCoppia,
	ordinaPerGravita,
	rilevaConflitti
} from '../../src/lib/server/conflicts/engine';
import type { EventoPerConflitti } from '../../src/lib/server/conflicts/rules';
import { daLocaleAIstante } from '../../src/lib/time';

const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000000';
const ORG_B = 'bbbbbbbb-0000-0000-0000-000000000000';

const PRIMO = '11111111-0000-0000-0000-000000000000';
const SECONDO = '22222222-0000-0000-0000-000000000000';
const TERZO = '33333333-0000-0000-0000-000000000000';

const PERUGIA = { lat: 43.1107, lon: 12.3908 };
const MILANO = { lat: 45.4642, lon: 9.19 };
const CIRCOLO = 'eeeeeeee-0000-0000-0000-000000000000';
const OPETH = 'cccccccc-0000-0000-0000-000000000000';

function evento(over: Partial<EventoPerConflitti> = {}): EventoPerConflitti {
	return {
		id: PRIMO,
		organizationId: ORG_A,
		venueId: null,
		startsAt: daLocaleAIstante('2026-10-12T22:00'),
		endsAt: null,
		doorsAt: null,
		...PERUGIA,
		raggioKm: 60,
		generi: [{ path: 'metal.death-metal', isPrimary: true }],
		lineup: [],
		...over
	};
}

describe('ordinamento della coppia', () => {
	it('mette per primo l’id minore, in qualunque ordine arrivino', () => {
		// È l'invariante che il CHECK su `conflicts` fa rispettare: senza, la
		// stessa situazione entrerebbe due volte e l'indice unico non
		// servirebbe a niente.
		const x = { id: SECONDO };
		const y = { id: PRIMO };
		expect(ordinaCoppia(x, y)).toEqual([y, x]);
		expect(ordinaCoppia(y, x)).toEqual([y, x]);
	});
});

describe('conflitti fra due date', () => {
	it('due date della stessa organizzazione non entrano mai in conflitto', () => {
		// Se un circolo mette due concerti la stessa sera, lo sa già:
		// avvisarlo di una cosa che ha deciso è solo rumore.
		const a = evento({ id: PRIMO, venueId: CIRCOLO });
		const b = evento({ id: SECONDO, venueId: CIRCOLO });
		expect(conflittiFraEventi(a, b)).toEqual([]);
	});

	it('una data non entra in conflitto con sé stessa', () => {
		const a = evento();
		expect(conflittiFraEventi(a, a)).toEqual([]);
	});

	it('la coppia restituita è sempre ordinata, indipendentemente da chi chiama', () => {
		const a = evento({ id: SECONDO });
		const b = evento({ id: PRIMO, organizationId: ORG_B });

		for (const trovati of [conflittiFraEventi(a, b), conflittiFraEventi(b, a)]) {
			expect(trovati.length).toBeGreaterThan(0);
			for (const c of trovati) {
				expect(c.eventAId).toBe(PRIMO);
				expect(c.eventBId).toBe(SECONDO);
			}
		}
	});

	it('una coppia può produrre più conflitti insieme', () => {
		// Stesso locale la stessa sera è, per forza di cose, anche una
		// sovrapposizione geografica. Le regole restano indipendenti: è
		// l'interfaccia a raggrupparle per coppia e a mostrare la più grave.
		const a = evento({ id: PRIMO, venueId: CIRCOLO });
		const b = evento({ id: SECONDO, organizationId: ORG_B, venueId: CIRCOLO });

		const kinds = conflittiFraEventi(a, b).map((c) => c.kind);
		expect(kinds).toContain('venue_clash');
		expect(kinds).toContain('geo_genre_overlap');
	});

	it('R3 e R4 non compaiono mai insieme sulla stessa coppia', () => {
		const a = evento({ id: PRIMO });
		const b = evento({ id: SECONDO, organizationId: ORG_B });

		const kinds = conflittiFraEventi(a, b).map((c) => c.kind);
		expect(kinds).toContain('geo_genre_overlap');
		expect(kinds).not.toContain('same_day_proximity');
	});
});

describe('rilevamento su un elenco di candidati', () => {
	it('confronta il candidato con tutti e scarta chi non c’entra', () => {
		const candidato = evento({ id: PRIMO, lineup: [{ artistId: OPETH, isAnnounced: true }] });

		const vicino = evento({
			id: SECONDO,
			organizationId: ORG_B,
			lineup: [{ artistId: OPETH, isAnnounced: true }]
		});
		const lontano = evento({
			id: TERZO,
			organizationId: ORG_B,
			lineup: [{ artistId: OPETH, isAnnounced: true }],
			...MILANO
		});

		const trovati = rilevaConflitti(candidato, [vicino, lontano]);
		const coinvolti = new Set(trovati.flatMap((c) => [c.eventAId, c.eventBId]));

		expect(coinvolti.has(SECONDO)).toBe(true);
		expect(coinvolti.has(TERZO)).toBe(false);
	});

	it('un elenco vuoto non produce conflitti', () => {
		expect(rilevaConflitti(evento(), [])).toEqual([]);
	});
});

describe('gravità', () => {
	it('ordina dal più grave al meno grave', () => {
		const dentro = [
			{ severity: 'low' as const },
			{ severity: 'high' as const },
			{ severity: 'medium' as const }
		];
		expect(ordinaPerGravita(dentro).map((c) => c.severity)).toEqual(['high', 'medium', 'low']);
	});

	it('non modifica l’array che riceve', () => {
		const dentro = [{ severity: 'low' as const }, { severity: 'high' as const }];
		ordinaPerGravita(dentro);
		expect(dentro.map((c) => c.severity)).toEqual(['low', 'high']);
	});

	it('la notifica scatta da `medium` in su', () => {
		// ARCHITECTURE.md §6.4 punto 3 e §10: un `low` è informativo, e
		// mandare un'email per ogni serata in zona è il modo migliore per far
		// ignorare anche quelle che contano.
		expect(meritaNotifica('high')).toBe(true);
		expect(meritaNotifica('medium')).toBe(true);
		expect(meritaNotifica('low')).toBe(false);
	});
});
