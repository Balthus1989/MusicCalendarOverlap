import { describe, expect, it } from 'vitest';
import {
	DEFAULT_NEXT,
	destinazioneDopoAccesso,
	safeNext
} from '../../src/lib/server/auth/redirect';

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

describe('destinazioneDopoAccesso', () => {
	const base = { next: null, codiceInvito: null, haMembership: false };

	it('manda al calendario chi entra senza niente addosso', () => {
		expect(destinazioneDopoAccesso(base)).toBe(DEFAULT_NEXT);
	});

	it("porta all'invito chi ha il codice nei metadati e nessuna organizzazione", () => {
		expect(destinazioneDopoAccesso({ ...base, codiceInvito: 'abc123XYZ0' })).toBe(
			'/invite/abc123XYZ0'
		);
	});

	it("ignora il codice quando la persona è già dentro un'organizzazione", () => {
		// Un invito con più utilizzi resta valido dopo essere stato riscattato:
		// senza questa condizione chi rientra verrebbe rimandato ogni volta su
		// una pagina che non ha più niente da fargli accettare.
		expect(
			destinazioneDopoAccesso({ ...base, codiceInvito: 'abc123XYZ0', haMembership: true })
		).toBe(DEFAULT_NEXT);
	});

	it('preferisce un `next` esplicito al codice nei metadati', () => {
		expect(
			destinazioneDopoAccesso({ ...base, next: '/events/1/edit', codiceInvito: 'abc123XYZ0' })
		).toBe('/events/1/edit');
	});

	it('non si fa portare fuori sito da un `next` ostile', () => {
		// `safeNext` rifiuta, e il codice di invito riprende il suo posto.
		expect(
			destinazioneDopoAccesso({
				...base,
				next: 'https://evil.example/phish',
				codiceInvito: 'abc123XYZ0'
			})
		).toBe('/invite/abc123XYZ0');
	});

	it('tratta un codice vuoto o di soli spazi come assente', () => {
		expect(destinazioneDopoAccesso({ ...base, codiceInvito: '   ' })).toBe(DEFAULT_NEXT);
		expect(destinazioneDopoAccesso({ ...base, codiceInvito: '' })).toBe(DEFAULT_NEXT);
	});

	it('codifica il codice, che finisce dentro un path', () => {
		expect(destinazioneDopoAccesso({ ...base, codiceInvito: 'a/b?c' })).toBe('/invite/a%2Fb%3Fc');
	});
});
