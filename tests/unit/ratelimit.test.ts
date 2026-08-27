/**
 * Il rate limit degli endpoint che chiamano qualcun altro (§16, ADR-0037).
 *
 * La parte con l'incremento atomico si prova solo contro un database vero;
 * quella che decide — quale riga si incrementa, e quando quella riga cambia —
 * è pura, ed è anche l'unica dove un errore passa inosservato: una chiave
 * costruita male non fallisce, conta male.
 */
import { describe, expect, it } from 'vitest';
import {
	FINESTRA_MS,
	LIMITI,
	chiaveFinestra,
	scadenzaFinestra,
	secondiAllaProssimaFinestra
} from '../../src/lib/server/ratelimit';

const alle = (iso: string) => new Date(iso);

describe('la chiave della finestra', () => {
	it('è la stessa per due richieste dentro la stessa ora', () => {
		const a = chiaveFinestra('geocode', 'p1', alle('2026-10-12T14:00:01Z'));
		const b = chiaveFinestra('geocode', 'p1', alle('2026-10-12T14:59:59Z'));
		expect(a).toBe(b);
	});

	it('cambia quando la finestra cambia', () => {
		const a = chiaveFinestra('geocode', 'p1', alle('2026-10-12T14:59:59Z'));
		const b = chiaveFinestra('geocode', 'p1', alle('2026-10-12T15:00:00Z'));
		expect(a).not.toBe(b);
	});

	it('separa i soggetti', () => {
		const adesso = alle('2026-10-12T14:00:00Z');
		expect(chiaveFinestra('geocode', 'p1', adesso)).not.toBe(
			chiaveFinestra('geocode', 'p2', adesso)
		);
	});

	it('separa le risorse, anche a parità di soggetto', () => {
		// Il feed è contato per token e il geocoding per profilo, ma niente
		// vieta che i due valori coincidano: senza il prefisso di risorsa,
		// scaricare il feed consumerebbe le ricerche di indirizzo.
		const adesso = alle('2026-10-12T14:00:00Z');
		expect(chiaveFinestra('geocode', 'x', adesso)).not.toBe(chiaveFinestra('ics', 'x', adesso));
	});

	it('tronca all’inizio della finestra, non all’istante della prima richiesta', () => {
		// Se la finestra partisse dalla prima richiesta, ogni riga avrebbe una
		// scadenza diversa e due richieste vicine potrebbero finire su due
		// righe: il conteggio sarebbe la metà del vero.
		const chiave = chiaveFinestra('ics', 'tok', alle('2026-10-12T14:37:12Z'));
		const inizio = Number(chiave.split(':').at(-1));
		expect(inizio % FINESTRA_MS).toBe(0);
		expect(new Date(inizio).toISOString()).toBe('2026-10-12T14:00:00.000Z');
	});
});

describe('la scadenza della riga', () => {
	it('è oltre la fine della propria finestra', () => {
		const adesso = alle('2026-10-12T14:30:00Z');
		const scadenza = scadenzaFinestra(adesso);
		expect(scadenza.getTime()).toBeGreaterThan(adesso.getTime() + FINESTRA_MS / 2);
	});

	it('non è nel passato nemmeno all’ultimo istante della finestra', () => {
		// Una riga scaduta prima della fine della sua finestra verrebbe
		// cancellata dalla corsa notturna mentre sta ancora contando.
		const quasiFine = alle('2026-10-12T14:59:59Z');
		expect(scadenzaFinestra(quasiFine).getTime()).toBeGreaterThan(quasiFine.getTime());
	});
});

describe('quanto aspettare', () => {
	it('è il tempo che manca alla finestra successiva', () => {
		expect(secondiAllaProssimaFinestra(alle('2026-10-12T14:00:00Z'))).toBe(3600);
		expect(secondiAllaProssimaFinestra(alle('2026-10-12T14:59:00Z'))).toBe(60);
	});

	it('non è mai zero', () => {
		// `Retry-After: 0` invita a riprovare subito, che è l'opposto.
		expect(secondiAllaProssimaFinestra(alle('2026-10-12T14:59:59.999Z'))).toBeGreaterThanOrEqual(1);
	});
});

describe('i limiti', () => {
	it('lasciano spazio a più client calendario sullo stesso feed', () => {
		// `REFRESH-INTERVAL` è dodici ore: due letture al giorno per client.
		// Ventiquattro all'ora sono lontanissime da un uso normale e vicine a
		// un ciclo, che è la distinzione che serve.
		expect(LIMITI.ics).toBeGreaterThanOrEqual(12);
	});

	it('sono più larghi sul geocoding, che parte mentre si scrive', () => {
		expect(LIMITI.geocode).toBeGreaterThan(LIMITI.ics);
	});

	it('sono i più stretti sugli inviti, che consumano la casella di qualcun altro', () => {
		// Gli altri due difendono da un ciclo impazzito e possono permettersi
		// di essere larghi. Questo difende la Gmail da cui partono le email
		// (ADR-0045): il tetto è giornaliero e la reputazione del mittente si
		// brucia una volta sola.
		expect(LIMITI.inviti).toBeLessThan(LIMITI.ics);
		// E deve restare sopra un pomeriggio di ingressi vero.
		expect(LIMITI.inviti).toBeGreaterThanOrEqual(5);
	});
});
