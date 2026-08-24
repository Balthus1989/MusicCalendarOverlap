/**
 * Il registro delle modifiche: i testi e la metrica di §1.
 *
 * `calcolaDiff` è la parte più vecchia e la più facile da rompere senza
 * accorgersene: confronta per valore serializzato, perché lineup e generi
 * cambiano identità a ogni lettura dal database, e un confronto per
 * riferimento farebbe risultare modificato tutto a ogni salvataggio.
 *
 * `metricaHold` è la misura di successo del prodotto (§1). Conta ogni data una
 * volta sola, alla prima conferma: una serata annullata e riconfermata non
 * vale doppio, altrimenti la metrica premierebbe le date travagliate.
 */
import { describe, expect, it } from 'vitest';
import {
	cambi,
	etichettaAzione,
	etichettaCampo,
	metricaHold,
	nomeAttore,
	valoreLeggibile,
	type PassaggioStato,
	type VoceAudit
} from '../../src/lib/audit';
import { calcolaDiff } from '../../src/lib/server/audit';

/* ------------------------------------------------------------------ *
 * Diff
 * ------------------------------------------------------------------ */

describe('calcolaDiff', () => {
	it('segnala solo i campi cambiati davvero', () => {
		const diff = calcolaDiff(
			{ status: 'hold', title: 'Serata' },
			{ status: 'confirmed', title: 'Serata' }
		);
		expect(diff).toEqual({ status: ['hold', 'confirmed'] });
	});

	it('non tratta un update parziale come cancellazione del resto', () => {
		// Confronta solo le chiavi presenti in "dopo": chi aggiorna lo stato
		// non passa il titolo, e il titolo non è sparito.
		const diff = calcolaDiff({ status: 'hold', title: 'Serata' }, { status: 'confirmed' });
		expect(diff).toEqual({ status: ['hold', 'confirmed'] });
	});

	it('confronta le date per valore, non per identità', () => {
		const quando = new Date('2026-10-12T20:00:00Z');
		expect(calcolaDiff({ startsAt: quando }, { startsAt: new Date(quando) })).toBeNull();
	});

	it('vede una data spostata', () => {
		const diff = calcolaDiff(
			{ startsAt: new Date('2026-10-12T20:00:00Z') },
			{ startsAt: new Date('2026-10-14T20:00:00Z') }
		);
		expect(diff?.startsAt?.[1]).toBe('2026-10-14T20:00:00.000Z');
	});

	it('restituisce null quando non è cambiato niente', () => {
		expect(calcolaDiff({ title: 'Serata' }, { title: 'Serata' })).toBeNull();
	});

	it('tratta undefined e null come la stessa assenza', () => {
		// `venueId` non impostato arriva come `undefined` dal form e come
		// `null` dal database: senza normalizzazione ogni salvataggio
		// risulterebbe una modifica del locale.
		expect(calcolaDiff({ venueId: null }, { venueId: undefined })).toBeNull();
	});
});

/* ------------------------------------------------------------------ *
 * Testi
 * ------------------------------------------------------------------ */

const voce = (over: Partial<VoceAudit> = {}): VoceAudit => ({
	id: 'a1',
	entityType: 'event',
	entityId: 'e1',
	action: 'status_change',
	attore: 'Anna',
	diff: { status: ['hold', 'confirmed'] },
	createdAt: new Date('2026-10-01T09:00:00Z'),
	...over
});

describe('come si legge una voce', () => {
	it('traduce lo stato invece di stampare l’enum', () => {
		// "hold → confirmed" è una riga di database. Chi legge il registro
		// cerca la stessa parola che vede sul badge della data.
		const [c] = cambi(voce());
		expect(c.campo).toBe('stato');
		expect(c.prima).not.toBe('hold');
		expect(c.dopo).not.toBe('confirmed');
	});

	it('scrive le date in italiano, non in ISO', () => {
		// È il caso più frequente del registro — una serata spostata — e
		// stampare l'ISO lo renderebbe illeggibile proprio lì.
		const leggibile = valoreLeggibile('startsAt', '2026-10-12T20:00:00.000Z');
		expect(leggibile).toContain('12 ott');
		expect(leggibile).not.toContain('T20:00');
	});

	it('rende l’assenza di valore con un trattino, non con "null"', () => {
		expect(valoreLeggibile('title', null)).toBe('—');
		expect(valoreLeggibile('title', '')).toBe('—');
	});

	it('non pretende di nominare il locale, di cui ha solo l’id', () => {
		// L'alternativa sarebbe stampare un uuid, che non dice niente a
		// nessuno. Il nome del locale nuovo si legge nella pagina della data.
		expect(valoreLeggibile('venueId', 'aaaa-bbbb')).toBe('un altro locale');
	});

	it('dice che l’attore è stato rimosso invece di lasciare un vuoto', () => {
		// La foreign key è `on delete set null`: il fatto che la modifica sia
		// avvenuta resta vero anche se chi l'ha fatta ha lasciato il calendario.
		expect(nomeAttore(null)).toBe('profilo rimosso');
		expect(nomeAttore('Anna')).toBe('Anna');
	});

	it('non nasconde un’azione senza diff', () => {
		const senzaDiff = voce({ action: 'delete', diff: null });
		expect(cambi(senzaDiff)).toEqual([]);
		expect(etichettaAzione(senzaDiff.action)).toBe('eliminata');
	});

	it('lascia passare un campo che non conosce invece di perderlo', () => {
		expect(etichettaCampo('campo_nuovo')).toBe('campo_nuovo');
		expect(etichettaAzione('azione_nuova')).toBe('azione_nuova');
	});
});

/* ------------------------------------------------------------------ *
 * La metrica di §1
 * ------------------------------------------------------------------ */

describe('la quota di date passate da «opzionata»', () => {
	const p = (entityId: string, a: string, da: string | null = null): PassaggioStato => ({
		entityId,
		da,
		a
	});

	it('conta separatamente chi è passato da hold e chi no', () => {
		const metrica = metricaHold([
			p('e1', 'hold'),
			p('e1', 'confirmed', 'hold'),
			p('e2', 'confirmed')
		]);
		expect(metrica).toMatchObject({ conHold: 1, senzaHold: 1, totale: 2, quota: 0.5 });
	});

	it('ignora le date che non sono mai state confermate', () => {
		// Una data ancora opzionata non dice niente sulla metrica: dirà
		// qualcosa quando verrà confermata o annullata.
		const metrica = metricaHold([p('e1', 'hold'), p('e2', 'draft')]);
		expect(metrica.totale).toBe(0);
		expect(metrica.quota).toBeNull();
	});

	it('conta ogni data una volta sola, alla prima conferma', () => {
		// Annullata e riconfermata: se contasse due volte, la metrica
		// premierebbe le serate travagliate.
		const metrica = metricaHold([
			p('e1', 'confirmed'),
			p('e1', 'cancelled', 'confirmed'),
			p('e1', 'hold', 'cancelled'),
			p('e1', 'confirmed', 'hold')
		]);
		expect(metrica).toMatchObject({ conHold: 0, senzaHold: 1, totale: 1 });
	});

	it('una data nata in bozza e poi opzionata conta come opzionata', () => {
		// Il percorso `draft → hold → confirmed` è quello che il prodotto
		// vuole vedere: la bozza non è un annuncio, l'opzione sì.
		const metrica = metricaHold([
			p('e1', 'draft'),
			p('e1', 'hold', 'draft'),
			p('e1', 'confirmed', 'hold')
		]);
		expect(metrica.conHold).toBe(1);
	});

	it('senza nessun passaggio non inventa un numero', () => {
		expect(metricaHold([]).quota).toBeNull();
	});
});
