/**
 * Riconoscimento della sorgente (ARCHITECTURE.md §9, Fase 5).
 *
 * L'asimmetria è la cosa da provare. Un falso `testo` costa una chiamata al
 * modello che non serviva; un falso `csv` fa leggere come tabella un post di
 * Facebook e riempie un form di spazzatura senza che nessun errore lo dica.
 * Quindi: nel dubbio, testo — e questi test guardano soprattutto quel verso.
 */
import { describe, expect, it } from 'vitest';
import { riconosciSorgente } from '../../src/lib/server/parse/sniff';

const POST = `🔥 SABATO 12 OTTOBRE 🔥
BASSA MAREA + NERO SABBIA
Circolo Arci Lupo Bianco, Perugia
Porte 21:00, inizio 22:00
Ingresso 8€ con tessera ARCI
Info e prevendite: link in bio`;

describe('riconoscimento della sorgente', () => {
	it('riconosce un calendario', () => {
		expect(
			riconosciSorgente('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VEVENT\r\nEND:VCALENDAR')
		).toBe('ics');
	});

	it('riconosce una tabella con intestazioni note', () => {
		expect(riconosciSorgente('giorno,ora_inizio,titolo,citta\r\n2026-10-12,22:00,X,Perugia')).toBe(
			'csv'
		);
	});

	it('riconosce una tabella con il punto e virgola', () => {
		expect(riconosciSorgente('giorno;titolo;locale\r\n12/10/2026;X;Y')).toBe('csv');
	});

	it('legge come testo un post di Instagram', () => {
		expect(riconosciSorgente(POST)).toBe('testo');
	});

	it('legge come testo una locandina che comincia con parole simili a colonne', () => {
		// «Data, luogo e orari» ha una virgola e delle parole che assomigliano
		// a intestazioni: è il falso positivo che romperebbe tutto in silenzio.
		const testo = 'Data, luogo e orari\nSabato 12 ottobre al Lupo Bianco di Perugia, dalle 22.';
		expect(riconosciSorgente(testo)).toBe('testo');
	});

	it('non basta una colonna riconoscibile sola', () => {
		expect(riconosciSorgente('titolo,pippo,pluto\r\nSerata,a,b')).toBe('testo');
	});

	it('legge come testo una tabella con la sola intestazione', () => {
		expect(riconosciSorgente('giorno,titolo,citta')).toBe('testo');
	});

	it('legge come testo un incolla lunghissimo su una riga sola', () => {
		const riga = `giorno,titolo,citta,${'parole a caso separate da virgole, '.repeat(30)}\nx,y,z`;
		expect(riconosciSorgente(riga)).toBe('testo');
	});

	it('legge come testo una stringa vuota', () => {
		expect(riconosciSorgente('')).toBe('testo');
	});
});
