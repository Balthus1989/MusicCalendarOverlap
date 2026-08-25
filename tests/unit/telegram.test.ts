/**
 * Il canale Telegram (ADR-0039, ADR-0040).
 *
 * Di questo file si prova la parte che decide, non quella che parla con la
 * rete. Sono tre cose, e la seconda è quella che può fare danni veri.
 *
 * Il **codice di collegamento**: se due codici si confondessero, un avviso
 * finirebbe nella chat sbagliata — cioè un conflitto redatto per un'altra
 * organizzazione consegnato a chi non doveva vederlo. È l'unico punto del
 * canale che può bucare la matrice di visibilità, e per questo il
 * riconoscimento è per parola intera e non per sottostringa.
 *
 * Il **corpo del messaggio**: senza taglio, un digest lungo viene rifiutato
 * da Telegram e l'avviso si perde per un motivo che non c'entra col suo
 * contenuto.
 */
import { describe, expect, it } from 'vitest';
import {
	MINUTI_VALIDITA_TOKEN,
	chatDalCodice,
	corpoTelegram,
	generaToken,
	linkCollegamento,
	tokenValido
} from '../../src/lib/server/notifications/sinks/telegram';
import type { Avviso, Destinatario } from '../../src/lib/server/notifications/types';

const destinatario: Destinatario = {
	profileId: 'ffffffff-0000-0000-0000-000000000000',
	displayName: 'Anna',
	email: 'anna@circolo.example'
};

const avviso = (over: Partial<Avviso> = {}): Avviso => ({
	kind: 'conflitto_nuovo',
	destinatario,
	titolo: 'Stessa sera, stessa zona, pubblico simile',
	testo: 'Circolo Beta ha una data la tua stessa sera a Perugia.',
	url: '/conflicts',
	dedupeKey: 'conflitto_nuovo:x',
	...over
});

/* ------------------------------------------------------------------ *
 * Il codice di collegamento
 * ------------------------------------------------------------------ */

describe('il codice di collegamento', () => {
	it('non contiene i caratteri che si confondono a rileggerli', () => {
		// Il codice si legge da uno schermo e si riscrive su un telefono. `O` e
		// `0`, `I` e `1` sono il modo più rapido di far fallire un collegamento
		// che sarebbe andato bene.
		const codici = Array.from({ length: 200 }, () => generaToken());
		expect(codici.join('')).not.toMatch(/[O0I1]/);
	});

	it('è lungo quanto chiesto e fatto di sole maiuscole e cifre', () => {
		expect(generaToken()).toHaveLength(8);
		expect(generaToken(12)).toHaveLength(12);
		expect(generaToken()).toMatch(/^[A-Z2-9]+$/);
	});

	it('non si ripete', () => {
		// Non è una prova crittografica: è la controprova che il generatore
		// pesca davvero a caso invece di restituire sempre lo stesso valore.
		const insieme = new Set(Array.from({ length: 500 }, () => generaToken()));
		expect(insieme.size).toBe(500);
	});
});

describe('la scadenza del codice', () => {
	const emesso = new Date('2026-10-12T10:00:00Z');

	it('vale per la mezz’ora dichiarata', () => {
		expect(MINUTI_VALIDITA_TOKEN).toBe(30);
		expect(tokenValido(emesso, new Date('2026-10-12T10:29:00Z'))).toBe(true);
	});

	it('non vale più dopo', () => {
		expect(tokenValido(emesso, new Date('2026-10-12T10:31:00Z'))).toBe(false);
	});

	it('un codice mai emesso non è valido', () => {
		// `null` è lo stato di chi non ha mai iniziato un collegamento: senza
		// questo controllo, una chiamata a `verifica` senza `collega` prima
		// passerebbe al giro successivo con un token vuoto.
		expect(tokenValido(null)).toBe(false);
	});
});

/* ------------------------------------------------------------------ *
 * Dal messaggio alla chat
 * ------------------------------------------------------------------ */

const messaggio = (chatId: number, testo: string) => ({
	message: { chat: { id: chatId }, text: testo }
});

describe('trovare la chat dal codice', () => {
	it('riconosce il codice mandato con /start', () => {
		const updates = [messaggio(12345, '/start ABC23456')];
		expect(chatDalCodice(updates, 'ABC23456')).toBe('12345');
	});

	it('riconosce il codice scritto a mano, in minuscolo', () => {
		// Chi copia il codice a mano lo scrive come gli viene.
		expect(chatDalCodice([messaggio(999, 'abc23456')], 'ABC23456')).toBe('999');
	});

	it('sceglie la chat giusta quando ce ne sono altre', () => {
		const updates = [
			messaggio(111, '/start ZZZZZZZZ'),
			messaggio(222, '/start ABC23456'),
			messaggio(333, 'ciao')
		];
		expect(chatDalCodice(updates, 'ABC23456')).toBe('222');
	});

	it('**non** collega su una corrispondenza parziale', () => {
		// È il caso che conta: se il confronto fosse per sottostringa, il
		// codice `ABC23456` verrebbe riconosciuto dentro `ABC234567`, e un
		// avviso finirebbe nella chat di un altro — cioè un conflitto redatto
		// per un'organizzazione consegnato a chi non doveva vederlo.
		expect(chatDalCodice([messaggio(444, '/start ABC234567')], 'ABC23456')).toBeNull();
		expect(chatDalCodice([messaggio(444, '/start XABC23456')], 'ABC23456')).toBeNull();
	});

	it('non trova niente quando il messaggio non è ancora arrivato', () => {
		expect(chatDalCodice([], 'ABC23456')).toBeNull();
		expect(chatDalCodice([messaggio(1, 'ciao')], 'ABC23456')).toBeNull();
	});

	it('regge una risposta malformata invece di rompersi', () => {
		// Arriva dalla rete: non è un posto da cui fidarsi della forma.
		expect(chatDalCodice(null, 'ABC23456')).toBeNull();
		expect(chatDalCodice({ ok: true }, 'ABC23456')).toBeNull();
		expect(chatDalCodice([{}, { message: {} }, { message: { chat: {} } }], 'ABC23456')).toBeNull();
	});

	it('senza codice non collega niente', () => {
		// Un token vuoto non deve corrispondere al primo messaggio che passa.
		expect(chatDalCodice([messaggio(1, '/start')], '')).toBeNull();
	});
});

describe('il link al bot', () => {
	it('porta il codice dentro, così non va copiato a mano', () => {
		expect(linkCollegamento('ABC23456', 'calendario_bot')).toBe(
			'https://t.me/calendario_bot?start=ABC23456'
		);
	});

	it('senza username del bot non c’è link', () => {
		// La pagina ripiega sulle istruzioni scritte invece di offrire un link
		// che non porta da nessuna parte.
		expect(linkCollegamento('ABC23456', null)).toBeNull();
	});
});

/* ------------------------------------------------------------------ *
 * Il corpo del messaggio
 * ------------------------------------------------------------------ */

describe('il messaggio su Telegram', () => {
	const BASE = 'https://calendario.example';

	it('mette il titolo, il testo e il link', () => {
		const m = corpoTelegram(avviso(), BASE);
		expect(m).toContain('Stessa sera, stessa zona, pubblico simile');
		expect(m).toContain('Circolo Beta ha una data');
		expect(m).toContain('https://calendario.example/conflicts');
	});

	it('senza indirizzo dell’applicazione manda comunque il testo', () => {
		// Un avviso senza link è meno utile, ma tacere per una variabile
		// mancante sarebbe peggio.
		const m = corpoTelegram(avviso(), '');
		expect(m).toContain('Circolo Beta ha una data');
		expect(m).not.toContain('http');
	});

	it('non contiene marcatori di formattazione', () => {
		// Si manda in testo semplice di proposito: i nomi delle band li
		// scrivono gli utenti, e un underscore in un nome farebbe fallire
		// l'intero messaggio con un errore di parsing Markdown.
		const m = corpoTelegram(avviso({ testo: 'Suona *Nero_Sabbia* con [Ossario](x)' }), BASE);
		expect(m).toContain('*Nero_Sabbia*');
	});

	it('taglia i messaggi troppo lunghi invece di farli rifiutare', () => {
		// Telegram si ferma a 4096 caratteri. Un digest con quaranta voci ci
		// arriva, e un messaggio rifiutato è un avviso perso per un motivo che
		// non c'entra col suo contenuto.
		const m = corpoTelegram(avviso({ testo: 'x'.repeat(9000) }), BASE);
		expect(m.length).toBeLessThan(4096);
		expect(m).toContain('[…]');
	});

	it('un avviso senza link non finisce con una riga vuota', () => {
		const m = corpoTelegram(avviso({ url: null }), BASE);
		expect(m.endsWith('\n')).toBe(false);
	});
});
