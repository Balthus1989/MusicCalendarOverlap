/**
 * Export JSON, CSV e JSON-LD (ARCHITECTURE.md §8, principio 6).
 *
 * Un export è la scorciatoia più comoda per aggirare una matrice di
 * visibilità: nessuno guarda un CSV riga per riga, e un campo di troppo in
 * fondo alla ventesima colonna non lo nota nessuno. Per questo qui, come nel
 * feed, si controlla anche che certe stringhe **non compaiano nel file
 * intero**, non solo che le colonne giuste siano vuote.
 */
import { describe, expect, it } from 'vitest';
import { BOM_UTF8, COLONNE, esportaCsv, nomeFileExport } from '../../src/lib/server/export/csv';
import { aEventoEsportato, esportaJson, VERSIONE_EXPORT } from '../../src/lib/server/export/json';
import { aMusicEvent, esportaJsonLd } from '../../src/lib/server/export/jsonld';
import { daLocaleAIstante } from '../../src/lib/time';
import { BASE, estraneo, ID_EVENTO, proprietario, serializza } from './fixtures/eventi';

const DA = daLocaleAIstante('2026-09-01T00:00');
const A = daLocaleAIstante('2026-12-31T00:00');

/* ------------------------------------------------------------------ *
 * JSON
 * ------------------------------------------------------------------ */

describe('export JSON', () => {
	it('si dichiara: versione, istante e finestra', () => {
		const out = esportaJson([serializza({}, estraneo)], {
			baseUrl: BASE,
			da: DA,
			a: A,
			adesso: daLocaleAIstante('2026-09-10T12:00')
		});

		expect(out.versione).toBe(VERSIONE_EXPORT);
		expect(out.finestra.da).toBe(DA.toISOString());
		expect(out.eventi).toHaveLength(1);
	});

	it('dice se una riga è ridotta, invece di lasciar credere che i campi manchino', () => {
		const riga = aEventoEsportato(serializza({ status: 'hold' }, estraneo), BASE);

		expect(riga.visibilita).toBe('ridotta');
		expect(riga).not.toHaveProperty('titolo');
		expect(riga).not.toHaveProperty('locale');
		// Ciò che `hold` concede c'è tutto: giorno, città, genere, contatto.
		expect(riga.giorno).toBe('2026-10-12');
		expect(riga.citta).toBe('Perugia');
		expect(riga.organizzazione.email).toBe('info@associazione-x.example');
	});

	it('di una data confermata altrui esporta solo la lineup annunciata', () => {
		const riga = aEventoEsportato(serializza({}, estraneo), BASE);
		if (riga.visibilita !== 'completa') throw new Error('attesa visibilità completa');

		expect(riga.lineup.map((v) => v.nome)).toEqual(['Nero Sabbia']);
		expect(riga.noteInterne).toBeNull();
	});

	it('alla propria organizzazione restituisce tutto, note interne comprese', () => {
		const riga = aEventoEsportato(serializza({ status: 'hold' }, proprietario), BASE);
		if (riga.visibilita !== 'completa') throw new Error('attesa visibilità completa');

		expect(riga.lineup.map((v) => v.nome)).toEqual(['Nero Sabbia', 'Ossario Lucente']);
		expect(riga.noteInterne).toBe('Cachet 800 €.');
	});

	it('non fa uscire una band non annunciata da nessuna parte del file', () => {
		const testo = JSON.stringify(
			esportaJson([serializza({}, estraneo), serializza({ status: 'cancelled' }, estraneo)], {
				baseUrl: BASE,
				da: DA,
				a: A
			})
		);

		expect(testo).not.toContain('Ossario Lucente');
		expect(testo).not.toContain('Cachet 800');
	});
});

/* ------------------------------------------------------------------ *
 * CSV
 * ------------------------------------------------------------------ */

describe('export CSV', () => {
	it('apre col BOM e chiude le righe con CRLF, altrimenti Excel sbaglia', () => {
		const csv = esportaCsv([serializza({}, estraneo)], { baseUrl: BASE });

		expect(csv.startsWith(BOM_UTF8)).toBe(true);
		expect(csv).toContain('\r\n');
		expect(csv.endsWith('\r\n')).toBe(true);
	});

	it('ha un’intestazione e una riga per evento', () => {
		const csv = esportaCsv([serializza({}, estraneo), serializza({ status: 'hold' }, estraneo)], {
			baseUrl: BASE
		});
		const righe = csv.slice(BOM_UTF8.length).trimEnd().split('\r\n');

		expect(righe).toHaveLength(3);
		expect(righe[0].split(',')).toHaveLength(COLONNE.length);
	});

	it('cita tutte le celle, sempre: due righe dello stesso file non hanno forme diverse', () => {
		const csv = esportaCsv([serializza({}, estraneo)], { baseUrl: BASE });
		for (const riga of csv.slice(BOM_UTF8.length).trimEnd().split('\r\n')) {
			expect(riga.startsWith('"')).toBe(true);
			expect(riga.endsWith('"')).toBe(true);
		}
	});

	it('raddoppia le virgolette interne e non si fa spezzare da una virgola', () => {
		const csv = esportaCsv([serializza({ title: 'Serata "Doom", seconda parte' }, estraneo)], {
			baseUrl: BASE
		});

		expect(csv).toContain('"Serata ""Doom"", seconda parte"');
	});

	it('lascia vuote le colonne che una data opzionata altrui non concede', () => {
		const csv = esportaCsv([serializza({ status: 'hold' }, estraneo)], { baseUrl: BASE });

		expect(csv).not.toContain('Notte di Death Metal');
		expect(csv).not.toContain('Circolo Arci Il Grifo');
		expect(csv).not.toContain('Grindcore');
		expect(csv).not.toContain('Ossario Lucente');
		// Ma il genere principale e la città ci sono: è ciò che `hold` mostra.
		expect(csv).toContain('"Death Metal"');
		expect(csv).toContain('"Perugia"');
	});

	it('scrive gli orari come li legge un organizzatore, non in UTC', () => {
		const csv = esportaCsv([serializza({}, estraneo)], { baseUrl: BASE });
		// 22:00 di parete, non le 20:00 UTC che ci sono nel database.
		expect(csv).toContain('"22:00"');
	});

	it('mette la finestra nel nome del file: se ne scaricano diversi', () => {
		expect(nomeFileExport('csv', DA, A)).toBe('calendario-2026-09-01_2026-12-31.csv');
	});
});

/* ------------------------------------------------------------------ *
 * JSON-LD
 * ------------------------------------------------------------------ */

describe('export JSON-LD', () => {
	it('descrive una data confermata come MusicEvent', () => {
		const nodo = aMusicEvent(serializza({}, estraneo), BASE);

		expect(nodo).not.toBeNull();
		expect(nodo!['@type']).toBe('MusicEvent');
		expect(nodo!.name).toBe('Notte di Death Metal');
		expect(nodo!.eventStatus).toBe('https://schema.org/EventScheduled');
		expect(nodo!['@id']).toBe(`${BASE}/events/${ID_EVENTO}`);
		expect(nodo!.performer).toEqual([
			{ '@type': 'MusicGroup', name: 'Nero Sabbia', '@id': `${BASE}/artists/a1` }
		]);
	});

	it('segna come annullata una data annullata: chi aveva raccolto l’annuncio deve saperlo', () => {
		const nodo = aMusicEvent(serializza({ status: 'cancelled' }, estraneo), BASE);
		expect(nodo!.eventStatus).toBe('https://schema.org/EventCancelled');
	});

	it('non descrive una data che non è stata annunciata', () => {
		// Nemmeno alla propria organizzazione, che pure la vede tutta: JSON-LD
		// esiste per raccontare qualcosa a chi sta fuori, e una bozza o
		// un'opzione non sono eventi pubblici.
		expect(aMusicEvent(serializza({ status: 'draft' }, proprietario), BASE)).toBeNull();
		expect(aMusicEvent(serializza({ status: 'hold' }, proprietario), BASE)).toBeNull();
		// E tantomeno una vista in visibilità ridotta, che non ha un titolo.
		expect(aMusicEvent(serializza({ status: 'hold' }, estraneo), BASE)).toBeNull();
	});

	it('mette il contesto una volta sola, in testa al grafo', () => {
		const out = esportaJsonLd(
			[serializza({}, estraneo), serializza({ status: 'hold' }, estraneo)],
			{ baseUrl: BASE }
		);
		const grafo = out['@graph'] as Record<string, unknown>[];

		expect(out['@context']).toBe('https://schema.org');
		// L'opzionata è fuori: nel grafo resta solo la confermata.
		expect(grafo).toHaveLength(1);
		expect(grafo[0]).not.toHaveProperty('@context');
	});

	it('espone i prezzi come offerte, e l’ingresso libero come prezzo zero', () => {
		const aPagamento = aMusicEvent(serializza({}, estraneo), BASE)!;
		expect(aPagamento.offers).toEqual([
			expect.objectContaining({ name: 'Prevendita', price: '12.00', priceCurrency: 'EUR' }),
			expect.objectContaining({ name: 'Alla porta', price: '15.00' })
		]);

		const gratis = aMusicEvent(
			serializza({ isFree: true, pricePresale: null, priceDoor: null }, estraneo),
			BASE
		)!;
		expect(gratis.offers).toEqual([expect.objectContaining({ price: '0' })]);
		expect(gratis.isAccessibleForFree).toBe(true);
	});

	it('non porta fuori una band non annunciata né le note interne', () => {
		const testo = JSON.stringify(esportaJsonLd([serializza({}, estraneo)], { baseUrl: BASE }));

		expect(testo).not.toContain('Ossario Lucente');
		expect(testo).not.toContain('Cachet 800');
	});
});
