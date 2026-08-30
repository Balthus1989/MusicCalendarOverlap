import { describe, expect, it } from 'vitest';
import { indirizzoGiaRegistrato, metadatiDaRiallineare } from '../../src/lib/server/invites/invio';

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

/**
 * La regola che sta sotto al bug del 30 agosto 2026: un invitato entrava con
 * il link ricevuto per email e finiva su un invito revocato, perché
 * `inviteUserByEmail` scrive `data` nei `user_metadata` solo quando l'utente
 * lo crea, e al secondo invito allo stesso indirizzo l'utente esiste già.
 */
describe('metadatiDaRiallineare', () => {
	it('non chiede nessuna scrittura se il codice è già quello giusto', () => {
		expect(metadatiDaRiallineare({ codice_invito: 'abc123xyz0' }, 'abc123xyz0')).toBeNull();
	});

	it('riscrive il codice quando i metadati indicano un invito precedente', () => {
		expect(metadatiDaRiallineare({ codice_invito: 'vecchio123' }, 'nuovo45678')).toEqual({
			codice_invito: 'nuovo45678'
		});
	});

	it('scrive il codice anche quando i metadati non ne hanno mai avuto uno', () => {
		expect(metadatiDaRiallineare({}, 'nuovo45678')).toEqual({ codice_invito: 'nuovo45678' });
		expect(metadatiDaRiallineare(null, 'nuovo45678')).toEqual({ codice_invito: 'nuovo45678' });
		expect(metadatiDaRiallineare(undefined, 'nuovo45678')).toEqual({ codice_invito: 'nuovo45678' });
	});

	it('non butta via il resto dei metadati, che non sono roba nostra', () => {
		expect(
			metadatiDaRiallineare(
				{ codice_invito: 'vecchio123', email_verified: true, provider: 'email' },
				'nuovo45678'
			)
		).toEqual({ codice_invito: 'nuovo45678', email_verified: true, provider: 'email' });
	});
});
