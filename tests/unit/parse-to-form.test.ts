/**
 * Dal bersaglio del parser ai valori del form (ARCHITECTURE.md §9, Fase 5).
 *
 * Le tre asserzioni che contano più di tutte le altre stanno in fondo, sotto
 * «le tre cose che il parser non decide»: stato, annuncio delle band,
 * collegamento all'anagrafica. Sono tre modi diversi di far prendere a un
 * parser una decisione che è di una persona, e nessuno dei tre farebbe rumore
 * sbagliando (ADR-0031).
 */
import { describe, expect, it } from 'vitest';
import { bersaglioVuoto, type BersaglioParse } from '../../src/lib/schemas/parse';
import {
	prezzo,
	risolviGeneri,
	risolviLocale,
	url,
	versoIlForm,
	type ContestoForm,
	type GenereNoto,
	type LocaleNoto
} from '../../src/lib/server/parse/to-form';
import { valoriPredefiniti } from '../../src/lib/server/events/form';

const GENERI: GenereNoto[] = [
	{ slug: 'metal', name: 'Metal', path: 'metal' },
	{ slug: 'death-metal', name: 'Death Metal', path: 'metal.death-metal' },
	{ slug: 'punk', name: 'Punk', path: 'punk' },
	{ slug: 'hardcore', name: 'Hardcore', path: 'punk.hardcore' },
	{ slug: 'jazz', name: 'Jazz', path: 'jazz' }
];

const LOCALI: LocaleNoto[] = [
	{
		id: 'aaaaaaaa-0000-4000-8000-000000000001',
		name: 'Circolo Arci Lupo Bianco',
		city: 'Perugia',
		province: 'PG'
	},
	{
		id: 'aaaaaaaa-0000-4000-8000-000000000002',
		name: 'Sala Prove',
		city: 'Perugia',
		province: 'PG'
	},
	{ id: 'aaaaaaaa-0000-4000-8000-000000000003', name: 'Sala Prove', city: 'Terni', province: 'TR' }
];

const ORG = { id: 'bbbbbbbb-0000-4000-8000-000000000001', city: 'Perugia', province: 'PG' };

function contesto(): ContestoForm {
	return { base: valoriPredefiniti(ORG), generi: GENERI, locali: LOCALI };
}

function bersaglio(modifiche: Partial<BersaglioParse> = {}): BersaglioParse {
	return { ...bersaglioVuoto(), ...modifiche };
}

/* ------------------------------------------------------------------ *
 * Normalizzazioni
 * ------------------------------------------------------------------ */

describe('prezzi', () => {
	it('libera il numero da ciò che lo circonda', () => {
		expect(prezzo('12,50 €')).toBe('12,50');
		expect(prezzo('€ 8')).toBe('8');
		expect(prezzo('10 euro in prevendita')).toBe('10');
	});

	it('non inventa un prezzo dove non ce n’è', () => {
		expect(prezzo('offerta libera')).toBe('');
		expect(prezzo(null)).toBe('');
	});
});

describe('indirizzi', () => {
	it('antepone lo schema a un dominio nudo', () => {
		expect(url('bandcamp.com/serata')).toBe('https://bandcamp.com/serata');
	});

	it('lascia stare un indirizzo già completo', () => {
		expect(url('http://esempio.test/x')).toBe('http://esempio.test/x');
	});

	it('non trasforma in indirizzo una parola qualunque', () => {
		expect(url('TBA')).toBe('');
		expect(url('link in bio')).toBe('');
	});

	it('toglie la punteggiatura che si porta dietro un link a fine frase', () => {
		expect(url('https://esempio.test/x.')).toBe('https://esempio.test/x');
	});
});

/* ------------------------------------------------------------------ *
 * Tassonomia
 * ------------------------------------------------------------------ */

describe('generi', () => {
	it('riconosce il nome, lo slug e la forma con il trattino', () => {
		expect(risolviGeneri(['Death Metal'], GENERI).slugs).toEqual(['death-metal']);
		expect(risolviGeneri(['death-metal'], GENERI).slugs).toEqual(['death-metal']);
		expect(risolviGeneri(['DEATH METAL'], GENERI).slugs).toEqual(['death-metal']);
	});

	it('tiene l’ordine: il primo riconosciuto diventa il primario', () => {
		const esito = risolviGeneri(['Hardcore', 'Punk'], GENERI);
		expect(esito.slugs).toEqual(['hardcore', 'punk']);
	});

	it('non ripete lo stesso genere scritto in due modi', () => {
		expect(risolviGeneri(['Punk', 'punk', 'PUNK'], GENERI).slugs).toEqual(['punk']);
	});

	it('non inventa un genere che la tassonomia chiusa non ha', () => {
		// ADR-0007: la tassonomia la allarga un platform admin, non un import.
		const esito = risolviGeneri(['Crust', 'Jazz'], GENERI);
		expect(esito.slugs).toEqual(['jazz']);
		expect(esito.nonRiconosciuti).toEqual(['Crust']);
	});
});

/* ------------------------------------------------------------------ *
 * Locale
 * ------------------------------------------------------------------ */

describe('locale', () => {
	it('collega il nome identico a meno di accenti e punteggiatura', () => {
		expect(risolviLocale('circolo arci lupo bianco', null, LOCALI)?.city).toBe('Perugia');
	});

	it('non sceglie fra due omonimi in città diverse', () => {
		expect(risolviLocale('Sala Prove', null, LOCALI)).toBeNull();
	});

	it('sceglie fra due omonimi quando la città lo dice', () => {
		expect(risolviLocale('Sala Prove', 'Terni', LOCALI)?.province).toBe('TR');
	});

	it('non collega un nome soltanto somigliante', () => {
		// «Lupo Bianco» e «Lupo Grigio» sono a due lettere di distanza e sono
		// due posti in due paesi diversi. Su un campo che decide anche le
		// coordinate, un quasi-match è peggio di un campo vuoto.
		expect(risolviLocale('Circolo Arci Lupo Grigio', null, LOCALI)).toBeNull();
	});
});

/* ------------------------------------------------------------------ *
 * La mappatura
 * ------------------------------------------------------------------ */

describe('verso il form', () => {
	it('riempie i campi che il parser ha letto, e li segna', () => {
		const esito = versoIlForm(
			bersaglio({
				title: 'Serata Bassa Marea',
				city: 'Perugia',
				province: 'pg',
				startsAtLocal: '2026-10-12T22:00',
				doorsAtLocal: '2026-10-12T21:00',
				priceDoor: '8,00 €',
				genres: ['Punk', 'Hardcore'],
				venueName: 'Circolo Arci Lupo Bianco'
			}),
			contesto()
		);

		expect(esito.valori.title).toBe('Serata Bassa Marea');
		expect(esito.valori.province).toBe('PG');
		expect(esito.valori.startsAtLocal).toBe('2026-10-12T22:00');
		expect(esito.valori.doorsAtLocal).toBe('2026-10-12T21:00');
		expect(esito.valori.priceDoor).toBe('8,00');
		expect(esito.valori.primaryGenreSlug).toBe('punk');
		expect(esito.valori.secondaryGenreSlugs).toEqual(['hardcore']);
		expect(esito.valori.venueId).toBe(LOCALI[0].id);

		expect(esito.compilati).toContain('title');
		expect(esito.compilati).toContain('venueId');
		expect(esito.compilati).not.toContain('subtitle');
	});

	it('non tocca i campi che il parser non ha letto', () => {
		const base = valoriPredefiniti(ORG);
		const esito = versoIlForm(bersaglio({ title: 'X' }), contesto());

		expect(esito.valori.city).toBe(base.city);
		expect(esito.valori.internalNotes).toBe('');
		expect(esito.compilati).toEqual(['title']);
	});

	it('scarta una data illeggibile invece di scriverla a metà', () => {
		const esito = versoIlForm(bersaglio({ startsAtLocal: 'sabato prossimo' }), contesto());
		expect(esito.valori.startsAtLocal).toBe('');
		expect(esito.avvisi.join(' ')).toMatch(/non è utilizzabile/i);
	});

	it('riporta gli incerti del parser fra gli avvisi', () => {
		const esito = versoIlForm(
			bersaglio({ incerti: ['C’era scritto «ospite a sorpresa»'] }),
			contesto()
		);
		expect(esito.avvisi).toContain('C’era scritto «ospite a sorpresa»');
	});

	it('avvisa quando il locale non è in anagrafica', () => {
		const esito = versoIlForm(bersaglio({ venueName: 'Capannone di Tizio' }), contesto());
		expect(esito.valori.venueId).toBe('');
		expect(esito.avvisi.join(' ')).toMatch(/non è in anagrafica/i);
	});

	it('tiene il prezzo e avvisa quando il testo dice anche ingresso libero', () => {
		// Lo schema del form rifiuta i due insieme, e ha ragione. La
		// contraddizione però è nel testo di partenza.
		const esito = versoIlForm(bersaglio({ isFree: true, priceDoor: '8' }), contesto());
		expect(esito.valori.isFree).toBe(false);
		expect(esito.valori.priceDoor).toBe('8');
		expect(esito.avvisi.join(' ')).toMatch(/ingresso libero sia un prezzo/i);
	});

	it('accetta l’ingresso libero quando è l’unica cosa che il testo dice', () => {
		const esito = versoIlForm(bersaglio({ isFree: true }), contesto());
		expect(esito.valori.isFree).toBe(true);
	});
});

/* ------------------------------------------------------------------ *
 * Le tre cose che il parser non decide (ADR-0031)
 * ------------------------------------------------------------------ */

describe('ciò che resta di una persona', () => {
	it('la data nasce in bozza, qualunque cosa dica il testo', () => {
		// Un post pubblico sembra dire che la data è confermata. Confermare
		// però significa annunciare, e non lo annuncia un parser.
		const esito = versoIlForm(
			bersaglio({ title: 'Serata confermata!!', startsAtLocal: '2026-10-12T22:00' }),
			contesto()
		);
		expect(esito.valori.status).toBe('draft');
		expect(esito.compilati).not.toContain('status');
	});

	it('nessuna band arriva annunciata, nemmeno da un post pubblico', () => {
		// `is_announced` è la rivelazione progressiva di ADR-0005: la decide
		// chi porta la band, non chi incolla il testo.
		const esito = versoIlForm(
			bersaglio({
				lineup: [
					{ name: 'Bassa Marea', billing: 'headliner' },
					{ name: 'Nero Sabbia', billing: null }
				]
			}),
			contesto()
		);

		expect(esito.valori.lineup).toHaveLength(2);
		expect(esito.valori.lineup.every((v) => v.isAnnounced === false)).toBe(true);
	});

	it('nessuna band viene collegata all’anagrafica da sola', () => {
		// Un collegamento sbagliato non si vede nel form — il campo mostra il
		// nome giusto — e falsa la regola R2, che confronta gli id.
		const esito = versoIlForm(
			bersaglio({ lineup: [{ name: 'Bassa Marea', billing: null }] }),
			contesto()
		);
		expect(esito.valori.lineup[0].artistId).toBeNull();
		expect(esito.valori.lineup[0].artistName).toBe('Bassa Marea');
	});

	it('un billing non dichiarato diventa support, non headliner', () => {
		const esito = versoIlForm(bersaglio({ lineup: [{ name: 'X', billing: null }] }), contesto());
		expect(esito.valori.lineup[0].billing).toBe('support');
	});

	it('non scrive mai le note interne', () => {
		const esito = versoIlForm(bersaglio({ description: 'Testo del post' }), contesto());
		expect(esito.valori.internalNotes).toBe('');
		expect(esito.valori.description).toBe('Testo del post');
	});
});
