/**
 * Lettura di un CSV (ARCHITECTURE.md §9, Fase 5).
 *
 * Il caso che deve funzionare sempre è **il nostro export che rientra**: le
 * intestazioni di `export/csv.ts` sono quelle da cui parte la tabella degli
 * alias, e il giro di andata e ritorno è la sola prova che le due metà non si
 * siano allontanate. Il resto sono le forme che arrivano da un foglio di
 * calcolo di qualcun altro.
 */
import { describe, expect, it } from 'vitest';
import {
	dividiCsv,
	giorno,
	intestazioniRiconosciute,
	leggiCsv,
	normalizzaIntestazione,
	separatoreProbabile
} from '../../src/lib/server/parse/csv';
import { BOM_UTF8, COLONNE, esportaCsv } from '../../src/lib/server/export/csv';

describe('tokenizzazione RFC 4180', () => {
	it('tiene insieme una cella quotata che contiene il separatore', () => {
		expect(dividiCsv('a,"b,c",d', ',')).toEqual([['a', 'b,c', 'd']]);
	});

	it('tiene insieme una cella quotata che contiene un a-capo', () => {
		// È il caso normale appena c'è una descrizione: uno `split('\n')`
		// spezzerebbe la riga a metà e le colonne slitterebbero tutte.
		expect(dividiCsv('titolo,note\r\n"Serata","Prima riga\nSeconda riga"', ',')).toEqual([
			['titolo', 'note'],
			['Serata', 'Prima riga\nSeconda riga']
		]);
	});

	it('legge le virgolette raddoppiate come una virgoletta sola', () => {
		expect(dividiCsv('"dice ""ciao"""', ',')).toEqual([['dice "ciao"']]);
	});

	it('conta un CRLF come una fine riga sola', () => {
		expect(dividiCsv('a,b\r\nc,d\r\n', ',')).toEqual([
			['a', 'b'],
			['c', 'd']
		]);
	});

	it('toglie il BOM, che altrimenti nasconde la prima intestazione', () => {
		expect(dividiCsv(`${BOM_UTF8}giorno,titolo`, ',')).toEqual([['giorno', 'titolo']]);
	});
});

describe('intestazioni', () => {
	it('riconosce la stessa colonna scritta in modi diversi', () => {
		expect(normalizzaIntestazione('Prezzo Prevendita')).toBe('prezzo_prevendita');
		expect(normalizzaIntestazione('  CITTÀ  ')).toBe('citta');
		expect(normalizzaIntestazione('ora_inizio')).toBe('ora_inizio');
	});

	it('sceglie il separatore che fa riconoscere più colonne', () => {
		expect(separatoreProbabile('giorno;titolo;citta\r\n2026-10-12;X;Perugia')).toBe(';');
		expect(separatoreProbabile('giorno,titolo,citta\r\n2026-10-12,X,Perugia')).toBe(',');
	});

	it('riconosce tutte le colonne del nostro export', () => {
		// Se qualcuno aggiunge o rinomina una colonna in `export/csv.ts`, la
		// prima cosa che smette di funzionare è il reimport, in silenzio.
		expect(intestazioniRiconosciute([...COLONNE])).toBeGreaterThanOrEqual(12);
	});
});

describe('date', () => {
	it('legge la forma ISO', () => {
		expect(giorno('2026-10-12')).toBe('2026-10-12');
	});

	it('legge la forma italiana, con il giorno per primo', () => {
		expect(giorno('12/10/2026')).toBe('2026-10-12');
		expect(giorno('1.12.2026')).toBe('2026-12-01');
	});

	it('non legge niente da un testo che non è una data', () => {
		expect(giorno('sabato prossimo')).toBeNull();
		expect(giorno('45/13/2026')).toBeNull();
	});
});

describe('lettura', () => {
	const file = (righe: string[]) => righe.join('\r\n');

	it('legge la prima riga di dati e conta le altre', () => {
		const esito = leggiCsv(
			file([
				'giorno,ora_inizio,titolo,citta,provincia,locale,generi,lineup,prezzo_porta',
				'2026-10-12,22:00,Serata Bassa Marea,Perugia,PG,Circolo Lupo Bianco,Punk · Hardcore,Bassa Marea · Nero Sabbia,8.00',
				'2026-10-19,21:30,Altra serata,Terni,TR,Altro posto,Jazz,Trio,10.00'
			])
		);

		expect(esito.totaleRighe).toBe(2);
		expect(esito.bersaglio.title).toBe('Serata Bassa Marea');
		expect(esito.bersaglio.startsAtLocal).toBe('2026-10-12T22:00');
		expect(esito.bersaglio.city).toBe('Perugia');
		expect(esito.bersaglio.province).toBe('PG');
		expect(esito.bersaglio.venueName).toBe('Circolo Lupo Bianco');
		expect(esito.bersaglio.genres).toEqual(['Punk', 'Hardcore']);
		expect(esito.bersaglio.lineup.map((v) => v.name)).toEqual(['Bassa Marea', 'Nero Sabbia']);
		expect(esito.bersaglio.priceDoor).toBe('8.00');
	});

	it('porta la fine al giorno dopo quando è oltre la mezzanotte', () => {
		// «22:00 → 02:00» è la coda della stessa serata. Tenerla sullo stesso
		// giorno farebbe finire il concerto venti ore prima di cominciare, e
		// lo schema del form la rifiuterebbe con un messaggio incomprensibile.
		const esito = leggiCsv(
			file(['giorno,ora_inizio,ora_fine,titolo', '2026-10-12,22:00,02:00,Serata'])
		);
		expect(esito.bersaglio.startsAtLocal).toBe('2026-10-12T22:00');
		expect(esito.bersaglio.endsAtLocal).toBe('2026-10-13T02:00');
	});

	it('lo dice quando manca l’orario, invece di far passare mezzanotte per l’ora vera', () => {
		const esito = leggiCsv(file(['giorno,titolo', '2026-10-12,Serata']));
		expect(esito.bersaglio.startsAtLocal).toBe('2026-10-12T00:00');
		expect(esito.bersaglio.incerti.join(' ')).toMatch(/orario di inizio/i);
	});

	it('legge l’ingresso libero scritto in italiano', () => {
		const esito = leggiCsv(file(['giorno,titolo,ingresso_libero', '2026-10-12,Serata,sì']));
		expect(esito.bersaglio.isFree).toBe(true);
	});

	it('legge il punto e virgola di Excel italiano', () => {
		const esito = leggiCsv(file(['giorno;titolo;citta', '12/10/2026;Serata;Perugia']));
		expect(esito.bersaglio.title).toBe('Serata');
		expect(esito.bersaglio.city).toBe('Perugia');
	});

	it('lo dice quando c’è solo l’intestazione', () => {
		const esito = leggiCsv('giorno,titolo\r\n');
		expect(esito.totaleRighe).toBe(0);
		expect(esito.bersaglio.incerti).toHaveLength(1);
	});
});

describe('andata e ritorno con il nostro export', () => {
	it('un file prodotto da esportaCsv si rilegge', () => {
		// L'export lavora su `EventoSerializzato`; qui interessa il formato del
		// file, non la matrice di visibilità, quindi si costruisce la riga
		// minima che l'esportatore accetta.
		const evento = {
			id: '11111111-1111-4111-8111-111111111111',
			status: 'confirmed' as const,
			visibilita: 'completa' as const,
			giorno: '2026-10-12',
			city: 'Perugia',
			province: 'PG',
			startsAt: new Date('2026-10-12T20:00:00Z'),
			endsAt: null,
			title: 'Serata Bassa Marea',
			organizzazione: { name: 'Circolo Arci Lupo Bianco' },
			generePrimario: { name: 'Punk' },
			generi: [{ name: 'Punk' }, { name: 'Hardcore' }],
			lineup: [{ nome: 'Bassa Marea' }, { nome: 'Nero Sabbia' }],
			venue: { name: 'Circolo Lupo Bianco', address: 'Via Roma 1' },
			lat: 43.11,
			lon: 12.39,
			isFree: false,
			pricePresale: '8.00',
			priceDoor: '10.00',
			currency: 'EUR',
			ticketUrl: null
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any;

		const csv = esportaCsv([evento], { baseUrl: 'https://esempio.test' });
		const esito = leggiCsv(csv);

		expect(esito.totaleRighe).toBe(1);
		expect(esito.bersaglio.title).toBe('Serata Bassa Marea');
		expect(esito.bersaglio.city).toBe('Perugia');
		expect(esito.bersaglio.province).toBe('PG');
		expect(esito.bersaglio.venueName).toBe('Circolo Lupo Bianco');
		expect(esito.bersaglio.startsAtLocal).toBe('2026-10-12T22:00');
		expect(esito.bersaglio.lineup.map((v) => v.name)).toEqual(['Bassa Marea', 'Nero Sabbia']);
		expect(esito.bersaglio.pricePresale).toBe('8.00');
		expect(esito.bersaglio.priceDoor).toBe('10.00');

		// L'export scrive i generi in due colonne — `genere_principale` e
		// `generi` — e la prima è contenuta nella seconda. Prendendone una
		// sola si perderebbe Hardcore, o si perderebbe l'ordine che mette il
		// primario davanti.
		expect(esito.bersaglio.genres).toEqual(['Punk', 'Hardcore']);
	});
});
