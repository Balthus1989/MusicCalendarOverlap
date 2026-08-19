import { describe, expect, it } from 'vitest';
import { DEFAULT_NEXT, safeNext } from '../../src/lib/server/auth/redirect';

describe('safeNext', () => {
	it('accetta i path relativi alla radice', () => {
		expect(safeNext('/calendar')).toBe('/calendar');
		expect(safeNext('/events/123/edit')).toBe('/events/123/edit');
		expect(safeNext('/calendar?genre=metal&radius=60')).toBe('/calendar?genre=metal&radius=60');
	});

	it('ricade sul default quando il valore manca', () => {
		expect(safeNext(null)).toBe(DEFAULT_NEXT);
		expect(safeNext(undefined)).toBe(DEFAULT_NEXT);
		expect(safeNext('')).toBe(DEFAULT_NEXT);
	});

	it('rifiuta gli URL assoluti', () => {
		expect(safeNext('https://evil.example/phish')).toBe(DEFAULT_NEXT);
		expect(safeNext('http://evil.example')).toBe(DEFAULT_NEXT);
		expect(safeNext('javascript:alert(1)')).toBe(DEFAULT_NEXT);
	});

	it('rifiuta i path protocol-relative', () => {
		expect(safeNext('//evil.example')).toBe(DEFAULT_NEXT);
		expect(safeNext('//evil.example/calendar')).toBe(DEFAULT_NEXT);
	});

	it('rifiuta i backslash, che alcuni browser normalizzano in slash', () => {
		expect(safeNext('/\\evil.example')).toBe(DEFAULT_NEXT);
		expect(safeNext('/calendar\\..\\..')).toBe(DEFAULT_NEXT);
	});

	it('rifiuta uno schema mascherato da path', () => {
		expect(safeNext('/https://evil.example')).toBe(DEFAULT_NEXT);
	});
});
