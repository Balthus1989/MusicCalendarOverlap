/**
 * I testi degli avvisi.
 *
 * Sono la parte del motore che l'utente incontra davvero: se un avviso non si
 * capisce, la telefonata non parte e le quattro regole potevano anche non
 * esserci. Due cose in particolare vanno tenute ferme, e sono quelle testate
 * qui:
 *
 * - lo stesso giorno con la stessa band si racconta con parole **diverse**
 *   dagli altri casi, perché è un errore materiale e non una concorrenza
 *   (ADR-0021);
 * - nessun testo dice a un organizzatore cosa deve fare (ADR-0022).
 */
import { describe, expect, it } from 'vitest';
import {
	mailtoControparte,
	spiegazioneConflitto,
	titoloConflitto,
	type ConflittoLeggibile
} from '../../src/lib/conflicts';

function leggibile(over: Partial<ConflittoLeggibile> = {}): ConflittoLeggibile {
	return {
		kind: 'geo_genre_overlap',
		severity: 'medium',
		distanzaKm: 42,
		giorniDiDistanza: 0,
		controparte: {
			giorno: '2026-10-12',
			city: 'Terni',
			organizzazione: { name: 'Associazione Altra', emailContact: 'info@altra.example' }
		},
		artisti: [],
		venue: null,
		...over
	};
}

const doppioIngaggio = () =>
	leggibile({
		kind: 'artist_overlap',
		severity: 'high',
		giorniDiDistanza: 0,
		artisti: [{ id: 'x', nome: 'Opeth' }]
	});

const concorrenza = () =>
	leggibile({
		kind: 'artist_overlap',
		severity: 'medium',
		giorniDiDistanza: 4,
		artisti: [{ id: 'x', nome: 'Opeth' }]
	});

describe('la stessa band la stessa sera si racconta come un errore', () => {
	it('il titolo dice "impegnata altrove", non "vi contendete il pubblico"', () => {
		expect(titoloConflitto(doppioIngaggio())).toMatch(/impegnata altrove/i);
	});

	it('la spiegazione nomina le due possibilità concrete', () => {
		const testo = spiegazioneConflitto(doppioIngaggio());
		expect(testo).toMatch(/doppio ingaggio/i);
		expect(testo).toMatch(/inserita sbagliata/i);
	});

	it('a giorni di distanza il testo cambia e torna a parlare di pubblico', () => {
		const testo = spiegazioneConflitto(concorrenza());
		expect(testo).not.toMatch(/doppio ingaggio/i);
		expect(testo).toMatch(/pubblico/i);
		expect(testo).toMatch(/4 giorni/);
	});

	it('il giorno dopo si dice "il giorno prima o dopo", non "a 1 giorni"', () => {
		expect(spiegazioneConflitto(leggibile({ ...concorrenza(), giorniDiDistanza: 1 }))).toMatch(
			/il giorno prima o dopo/
		);
	});
});

describe('i quattro tipi hanno quattro testi distinti', () => {
	it.each([
		['venue_clash', /stesso locale/i],
		['artist_overlap', /band/i],
		['geo_genre_overlap', /pubblico simile/i],
		['same_day_proximity', /in zona/i]
	] as const)('%s ha un titolo riconoscibile', (kind, atteso) => {
		expect(
			titoloConflitto(leggibile({ kind, giorniDiDistanza: kind === 'artist_overlap' ? 3 : 0 }))
		).toMatch(atteso);
	});
});

describe('nessun testo dà ordini (ADR-0022)', () => {
	const tutti = [
		leggibile({ kind: 'venue_clash', venue: { name: 'Circolo Rurale' } }),
		doppioIngaggio(),
		concorrenza(),
		leggibile({ kind: 'geo_genre_overlap' }),
		leggibile({ kind: 'same_day_proximity' })
	];

	it('non dice "devi", non dice "non puoi", non autorizza', () => {
		// Il calendario mette in contatto due pari: non ha titolo per decidere
		// quale delle due serate abbia diritto a quella data. Anche un "puoi
		// procedere" sposterebbe il messaggio da "guarda che c'è questo" a
		// "ti autorizzo".
		for (const c of tutti) {
			const testo = `${titoloConflitto(c)} ${spiegazioneConflitto(c)}`;
			expect(testo).not.toMatch(/\bdevi\b|\bnon puoi\b|\bvietat/i);
		}
	});

	it('nomina sempre chi organizza l’altra data: è a lui che si deve scrivere', () => {
		for (const c of tutti) {
			expect(spiegazioneConflitto(c)).toContain('Associazione Altra');
		}
	});
});

describe('più band condivise', () => {
	it('le elenca con la congiunzione, non con le virgole fino in fondo', () => {
		const c = leggibile({
			kind: 'artist_overlap',
			giorniDiDistanza: 0,
			artisti: [
				{ id: '1', nome: 'Opeth' },
				{ id: '2', nome: 'Ulver' },
				{ id: '3', nome: 'Enslaved' }
			]
		});
		expect(spiegazioneConflitto(c)).toContain('Opeth, Ulver e Enslaved');
	});
});

describe('contatto della controparte', () => {
	it('costruisce un mailto già intestato con giorno e città', () => {
		const mailto = mailtoControparte(leggibile());
		expect(mailto).toContain('mailto:info@altra.example');
		expect(mailto).toContain(encodeURIComponent('Data del 2026-10-12 a Terni'));
	});

	it('senza indirizzo restituisce null invece di un link rotto', () => {
		const senza = leggibile({
			controparte: {
				giorno: '2026-10-12',
				city: 'Terni',
				organizzazione: { name: 'Associazione Altra', emailContact: null }
			}
		});
		expect(mailtoControparte(senza)).toBeNull();
	});
});

describe('distanza sconosciuta', () => {
	it('non finge un numero quando le coordinate mancano', () => {
		const c = leggibile({ kind: 'same_day_proximity', distanzaKm: null });
		expect(spiegazioneConflitto(c)).toMatch(/distanza sconosciuta/);
	});
});
