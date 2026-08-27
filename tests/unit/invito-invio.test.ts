import { describe, expect, it } from 'vitest';
import { indirizzoGiaRegistrato } from '../../src/lib/server/invites/invio';

/**
 * Il riconoscimento passa da un messaggio di errore, che è la cosa che invecchia
 * peggio in un'integrazione. Se un aggiornamento di Supabase cambia il testo,
 * l'invito a chi ha già un account tornerebbe a comparire come guasto generico —
 * e la pagina direbbe "email non partita" invece di "ha già un account".
 */
describe('indirizzoGiaRegistrato', () => {
	it('riconosce il codice tipizzato, che è la forma preferibile', () => {
		expect(indirizzoGiaRegistrato({ code: 'email_exists', message: '' })).toBe(true);
		expect(indirizzoGiaRegistrato({ code: 'user_already_exists', message: '' })).toBe(true);
	});

	it('riconosce le formulazioni testuali storiche', () => {
		expect(
			indirizzoGiaRegistrato({
				message: 'A user with this email address has already been registered'
			})
		).toBe(true);
		expect(indirizzoGiaRegistrato({ message: 'Email address already registered' })).toBe(true);
		expect(indirizzoGiaRegistrato({ message: 'User already exists' })).toBe(true);
	});

	it('non scambia per "già iscritto" un guasto vero', () => {
		expect(
			indirizzoGiaRegistrato({ code: 'over_email_send_rate_limit', message: 'rate limit' })
		).toBe(false);
		expect(indirizzoGiaRegistrato({ message: 'Error sending invite email' })).toBe(false);
		expect(indirizzoGiaRegistrato({ message: 'Invalid email address' })).toBe(false);
	});
});
