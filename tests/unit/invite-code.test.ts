import { describe, expect, it } from 'vitest';
import {
	LUNGHEZZA_CODICE,
	generateInviteCode,
	inviteState,
	isWellFormedInviteCode,
	normalizeInviteCode
} from '../../src/lib/server/invites/code';

describe('generateInviteCode', () => {
	it('produce codici della lunghezza richiesta', () => {
		expect(generateInviteCode()).toHaveLength(LUNGHEZZA_CODICE);
		expect(generateInviteCode(16)).toHaveLength(16);
	});

	it('usa solo caratteri non ambigui', () => {
		for (let i = 0; i < 200; i++) {
			// Niente 0/O, 1/l/I: un codice si detta al telefono.
			expect(generateInviteCode()).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]+$/);
		}
	});

	it('non si ripete', () => {
		const visti = new Set(Array.from({ length: 500 }, () => generateInviteCode()));
		expect(visti.size).toBe(500);
	});
});

describe('normalizeInviteCode', () => {
	it('perdona spazi, trattini e maiuscole', () => {
		expect(normalizeInviteCode('ABCD-EFGH-JK')).toBe('abcdefghjk');
		expect(normalizeInviteCode('  abcd efgh jk ')).toBe('abcdefghjk');
	});
});

describe('isWellFormedInviteCode', () => {
	it('accetta un codice generato', () => {
		expect(isWellFormedInviteCode(generateInviteCode())).toBe(true);
	});

	it('accetta la forma dettata a voce', () => {
		const c = generateInviteCode();
		expect(isWellFormedInviteCode(`${c.slice(0, 5)}-${c.slice(5)}`.toUpperCase())).toBe(true);
	});

	it('rifiuta lunghezze sbagliate', () => {
		expect(isWellFormedInviteCode('abcd')).toBe(false);
		expect(isWellFormedInviteCode('abcdefghjkmn')).toBe(false);
	});

	it('rifiuta i caratteri fuori alfabeto', () => {
		// 'o', 'l', 'i', '0', '1' non appartengono all'alfabeto.
		expect(isWellFormedInviteCode('abcdefghj0')).toBe(false);
		expect(isWellFormedInviteCode('abcdefghjo')).toBe(false);
	});
});

describe('inviteState', () => {
	const adesso = new Date('2026-10-12T20:00:00Z');

	it('è usabile finché ha usi e non è scaduto', () => {
		expect(
			inviteState({ expiresAt: new Date('2026-11-01T00:00:00Z'), uses: 0, maxUses: 1 }, adesso)
		).toEqual({ usable: true });
	});

	it('è usabile senza scadenza', () => {
		expect(inviteState({ expiresAt: null, uses: 2, maxUses: 5 }, adesso)).toEqual({
			usable: true
		});
	});

	it('è scaduto quando la data è passata', () => {
		expect(
			inviteState({ expiresAt: new Date('2026-10-01T00:00:00Z'), uses: 0, maxUses: 1 }, adesso)
		).toEqual({ usable: false, reason: 'scaduto' });
	});

	it('scade nell’istante esatto, non un secondo dopo', () => {
		expect(inviteState({ expiresAt: adesso, uses: 0, maxUses: 1 }, adesso)).toEqual({
			usable: false,
			reason: 'scaduto'
		});
	});

	it('è esaurito quando gli usi sono finiti', () => {
		expect(inviteState({ expiresAt: null, uses: 1, maxUses: 1 }, adesso)).toEqual({
			usable: false,
			reason: 'esaurito'
		});
	});

	it('si considera revocato azzerando maxUses', () => {
		expect(inviteState({ expiresAt: null, uses: 0, maxUses: 0 }, adesso)).toEqual({
			usable: false,
			reason: 'revocato'
		});
	});

	it('la scadenza batte l’esaurimento nel messaggio', () => {
		const stato = inviteState(
			{ expiresAt: new Date('2026-01-01T00:00:00Z'), uses: 9, maxUses: 1 },
			adesso
		);
		expect(stato).toEqual({ usable: false, reason: 'scaduto' });
	});
});
