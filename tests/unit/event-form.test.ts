/**
 * Il form evento è l'unico punto in cui dati scritti a mano diventano una
 * riga di database. Qui si fissano le conversioni che a occhio sembrano
 * ovvie e non lo sono: i checkbox assenti, le righe di lineup vuote, gli
 * indici con i buchi lasciati da una riga rimossa.
 */
import { describe, expect, it } from 'vitest';
import { righeIndicizzate, valoriMultipli } from '../../src/lib/server/forms';
import { validaEvento } from '../../src/lib/server/events/form';

const ORG = '11111111-1111-4111-8111-111111111111';
const ARTISTA = '22222222-2222-4222-8222-222222222222';
const LOCALE = '33333333-3333-4333-8333-333333333333';

/** Il minimo che il form manda sempre. */
function formBase(extra: Record<string, string> = {}): FormData {
	const f = new FormData();
	f.set('organizationId', ORG);
	f.set('status', 'draft');
	f.set('title', 'Notte di Death Metal');
	f.set('city', 'Perugia');
	f.set('country', 'IT');
	f.set('currency', 'EUR');
	f.set('startsAtLocal', '2026-10-12T22:00');
	for (const [k, v] of Object.entries(extra)) f.set(k, v);
	return f;
}

describe('righe indicizzate', () => {
	it('rimette in ordine gli indici e ne colma i buchi', () => {
		const f = new FormData();
		f.set('lineup.2.artistName', 'Terza');
		f.set('lineup.0.artistName', 'Prima');
		f.set('lineup.5.artistName', 'Quinta');

		expect(righeIndicizzate(f, 'lineup').map((r) => r.artistName)).toEqual([
			'Prima',
			'Terza',
			'Quinta'
		]);
	});

	it('non confonde due sotto-form diversi', () => {
		const f = new FormData();
		f.set('lineup.0.artistName', 'Band');
		f.set('links.0.label', 'Bandcamp');

		expect(righeIndicizzate(f, 'lineup')).toHaveLength(1);
		expect(righeIndicizzate(f, 'links')[0].label).toBe('Bandcamp');
	});

	it('ignora le chiavi che non hanno la forma prefisso.indice.campo', () => {
		const f = new FormData();
		f.set('lineup', 'qualcosa');
		f.set('lineup.pippo.artistName', 'Band');
		expect(righeIndicizzate(f, 'lineup')).toEqual([]);
	});

	it('raccoglie i valori ripetuti di un campo multiplo', () => {
		const f = new FormData();
		f.append('secondaryGenreSlugs', 'metal');
		f.append('secondaryGenreSlugs', '');
		f.append('secondaryGenreSlugs', 'punk');
		expect(valoriMultipli(f, 'secondaryGenreSlugs')).toEqual(['metal', 'punk']);
	});
});

describe('validazione del form', () => {
	it('accetta il minimo indispensabile', () => {
		const esito = validaEvento(formBase());
		expect(esito.ok).toBe(true);
		if (esito.ok) {
			expect(esito.dati.title).toBe('Notte di Death Metal');
			expect(esito.dati.status).toBe('draft');
			// I checkbox non spuntati non arrivano affatto: devono diventare
			// `false`, non `undefined`.
			expect(esito.dati.isFree).toBe(false);
			expect(esito.dati.isMultiDay).toBe(false);
		}
	});

	it('rifiuta una data senza titolo', () => {
		const f = formBase();
		f.set('title', '');
		const esito = validaEvento(f);
		expect(esito.ok).toBe(false);
		if (!esito.ok) expect(esito.errori.title).toBeTruthy();
	});

	it('rifiuta una fine che precede l’inizio', () => {
		const esito = validaEvento(formBase({ endsAtLocal: '2026-10-12T21:00' }));
		expect(esito.ok).toBe(false);
		if (!esito.ok) expect(esito.errori.endsAtLocal).toBeTruthy();
	});

	it('accetta una fine dopo la mezzanotte', () => {
		// Il caso normale di un concerto: finisce il giorno dopo.
		expect(validaEvento(formBase({ endsAtLocal: '2026-10-13T02:00' })).ok).toBe(true);
	});

	it('chiede il genere principale per opzionare una data', () => {
		// Senza, un hold nel calendario altrui non direbbe niente a nessuno.
		const esito = validaEvento(formBase({ status: 'hold' }));
		expect(esito.ok).toBe(false);
		if (!esito.ok) expect(esito.errori.primaryGenreSlug).toBeTruthy();
	});

	it('accetta un hold col genere principale', () => {
		expect(validaEvento(formBase({ status: 'hold', primaryGenreSlug: 'metal' })).ok).toBe(true);
	});

	it('non ammette insieme ingresso libero e prezzo', () => {
		const f = formBase({ pricePresale: '12' });
		f.set('isFree', 'on');
		const esito = validaEvento(f);
		expect(esito.ok).toBe(false);
		if (!esito.ok) expect(esito.errori.isFree).toBeTruthy();
	});

	it('accetta i prezzi scritti con la virgola', () => {
		const esito = validaEvento(formBase({ pricePresale: '12,50' }));
		expect(esito.ok).toBe(true);
		if (esito.ok) expect(esito.dati.pricePresale).toBe('12.50');
	});

	it('non ripete il genere principale fra i secondari', () => {
		const f = formBase({ primaryGenreSlug: 'metal' });
		f.append('secondaryGenreSlugs', 'metal');
		expect(validaEvento(f).ok).toBe(false);
	});
});

describe('lineup', () => {
	it('scarta le righe rimaste vuote', () => {
		const f = formBase();
		f.set('lineup.0.artistName', 'Opeth');
		f.set('lineup.1.artistName', '');
		f.set('lineup.1.artistId', '');

		const esito = validaEvento(f);
		expect(esito.ok).toBe(true);
		if (esito.ok) expect(esito.dati.lineup).toHaveLength(1);
	});

	it('tiene la riga che ha solo il collegamento all’anagrafica', () => {
		const f = formBase();
		f.set('lineup.0.artistId', ARTISTA);
		f.set('lineup.0.artistName', '');

		const esito = validaEvento(f);
		expect(esito.ok).toBe(true);
		if (esito.ok) expect(esito.dati.lineup[0].artistId).toBe(ARTISTA);
	});

	it('una band è annunciata solo se il checkbox è arrivato', () => {
		const f = formBase();
		f.set('lineup.0.artistName', 'Opeth');
		f.set('lineup.1.artistName', 'Band Segreta');
		f.set('lineup.0.isAnnounced', 'on');

		const esito = validaEvento(f);
		expect(esito.ok).toBe(true);
		if (esito.ok) {
			expect(esito.dati.lineup[0].isAnnounced).toBe(true);
			expect(esito.dati.lineup[1].isAnnounced).toBe(false);
		}
	});

	it('accetta il locale scelto dall’anagrafica', () => {
		const esito = validaEvento(formBase({ venueId: LOCALE }));
		expect(esito.ok).toBe(true);
		if (esito.ok) expect(esito.dati.venueId).toBe(LOCALE);
	});

	it('un locale non scelto vale null, non stringa vuota', () => {
		const esito = validaEvento(formBase({ venueId: '' }));
		expect(esito.ok).toBe(true);
		if (esito.ok) expect(esito.dati.venueId).toBeNull();
	});
});

describe('link', () => {
	it('scarta le righe vuote e valida le altre', () => {
		const f = formBase();
		f.set('links.0.label', 'Bandcamp');
		f.set('links.0.url', 'https://bandcamp.example/x');
		f.set('links.1.label', '');
		f.set('links.1.url', '');

		const esito = validaEvento(f);
		expect(esito.ok).toBe(true);
		if (esito.ok) expect(esito.dati.links).toHaveLength(1);
	});

	it('rifiuta un indirizzo senza schema', () => {
		const f = formBase();
		f.set('links.0.label', 'Bandcamp');
		f.set('links.0.url', 'bandcamp.example/x');

		const esito = validaEvento(f);
		expect(esito.ok).toBe(false);
		// Il percorso dell'errore è il `name` dell'input: serve a evidenziare
		// la riga giusta invece di dare un errore generico in cima al form.
		if (!esito.ok) expect(esito.errori['links.0.url']).toBeTruthy();
	});
});
