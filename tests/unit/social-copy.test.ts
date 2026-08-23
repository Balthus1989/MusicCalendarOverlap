/**
 * Copy per i social (ARCHITECTURE.md §8, ADR-0012).
 *
 * Il testo generato qui è destinato a essere **incollato in pubblico**. È la
 * distanza più corta fra il database e il mondo, e l'unico punto del prodotto
 * in cui un dato riservato non finirebbe in una pagina protetta da login ma
 * sotto una locandina su Instagram.
 *
 * Quindi si controlla la stessa cosa del feed e dell'export, e per la stessa
 * ragione: le band non annunciate e le note interne non compaiono nel testo,
 * comunque lo si giri.
 */
import { describe, expect, it } from 'vitest';
import { generaCopy, hashtag, isPiattaforma, PIATTAFORME } from '../../src/lib/server/social/copy';
import type { EventoCompleto } from '../../src/lib/server/visibility';
import { BASE, estraneo, ID_EVENTO, proprietario, serializza } from './fixtures/eventi';

function completo(over = {}, viewer = estraneo): EventoCompleto {
	const e = serializza(over, viewer);
	if (e.visibilita !== 'completa') throw new Error('attesa visibilità completa');
	return e;
}

const testo = (
	piattaforma: 'instagram' | 'facebook' | 'telegram',
	over = {},
	viewer = estraneo
) => {
	const copy = generaCopy(serializza(over, viewer), piattaforma, BASE);
	if (!copy) throw new Error('nessun copy generato');
	return copy.testo;
};

describe('riconoscimento della piattaforma', () => {
	it('accetta le tre previste e nient’altro', () => {
		for (const p of PIATTAFORME) expect(isPiattaforma(p)).toBe(true);
		expect(isPiattaforma('twitter')).toBe(false);
		expect(isPiattaforma('')).toBe(false);
	});
});

describe('che cosa entra nel testo', () => {
	it('mette giorno, ora, locale e band annunciate', () => {
		const t = testo('facebook');

		expect(t).toContain('Notte di Death Metal');
		expect(t).toContain('Lunedì 12 ottobre');
		expect(t).toContain('22:00');
		expect(t).toContain('Circolo Arci Il Grifo, Perugia (PG)');
		expect(t).toContain('Nero Sabbia');
		expect(t).toContain('Associazione X');
	});

	it('non nomina mai una band non annunciata, su nessuna piattaforma', () => {
		for (const p of PIATTAFORME) {
			expect(testo(p), p).not.toContain('Ossario Lucente');
		}
	});

	it('non fa uscire le note interne, nemmeno alla propria organizzazione', () => {
		for (const p of PIATTAFORME) {
			expect(testo(p, { status: 'confirmed' }, proprietario), p).not.toContain('Cachet 800');
		}
	});

	it('di una data opzionata altrui non genera niente, e lo dice', () => {
		const copy = generaCopy(serializza({ status: 'hold' }, estraneo), 'instagram', BASE);
		expect(copy).toBeNull();
	});

	it('scrive i prezzi in euro con la virgola, come si scrivono in Italia', () => {
		expect(testo('facebook')).toContain('12,00 €');
		expect(testo('facebook')).toContain('riservato ai tesserati');
	});

	it('l’ingresso libero si dice, non si omette', () => {
		const t = testo('telegram', { isFree: true, pricePresale: null, priceDoor: null });
		expect(t).toContain('Ingresso libero');
	});
});

describe('differenze fra le piattaforme', () => {
	it('Instagram non mette link cliccabili, perché non lo sono', () => {
		const t = testo('instagram');

		expect(t).not.toContain(`${BASE}/events/`);
		expect(t).not.toContain('https://biglietti.example');
		expect(t).toContain('link in bio');
	});

	it('Instagram chiude con gli hashtag, dove il pubblico se li aspetta', () => {
		const t = testo('instagram');
		expect(t).toContain('#deathmetal');
		expect(t).toContain('#perugia');
	});

	it('Facebook mette i link, perché lì funzionano', () => {
		const t = testo('facebook');
		expect(t).toContain(`${BASE}/events/${ID_EVENTO}`);
		expect(t).toContain('https://biglietti.example/notte');
	});

	it('Telegram resta compatto e senza hashtag: in un canale sono rumore', () => {
		const t = testo('telegram');

		expect(t).not.toContain('#');
		expect(t).toContain(`${BASE}/events/${ID_EVENTO}`);
		expect(t.split('\n').length).toBeLessThan(testo('facebook').split('\n').length);
	});

	it('non lascia mai tre a capo di fila, che è ciò che succede montando pezzi condizionali', () => {
		for (const p of PIATTAFORME) {
			expect(testo(p, { subtitle: null, ticketUrl: null }), p).not.toContain('\n\n\n');
		}
	});
});

describe('avvisi', () => {
	it('dice a chiare lettere che pubblicare una data opzionata è annunciarla', () => {
		const copy = generaCopy(serializza({ status: 'hold' }, proprietario), 'instagram', BASE)!;
		expect(copy.avvisi.join(' ')).toContain('non è ancora confermata');
	});

	it('avverte se la data è annullata', () => {
		const copy = generaCopy(serializza({ status: 'cancelled' }, proprietario), 'facebook', BASE)!;
		expect(copy.avvisi.join(' ')).toContain('annullata');
	});

	it('avverte quando nel testo non finisce nessun nome', () => {
		const copy = generaCopy(serializza({ lineup: [] }, estraneo), 'facebook', BASE)!;
		expect(copy.avvisi.join(' ')).toContain('Nessuna band annunciata');
	});

	it('su una data confermata e completa non ha niente da dire', () => {
		const copy = generaCopy(serializza({}, proprietario), 'facebook', BASE)!;
		expect(copy.avvisi).toEqual([]);
	});

	it('conta i caratteri in punti di codice, non in unità UTF-16', () => {
		const copy = generaCopy(serializza({}, estraneo), 'telegram', BASE)!;
		expect(copy.caratteri).toBe([...copy.testo].length);
	});
});

describe('hashtag', () => {
	it('normalizza i generi e non ne ripete due uguali', () => {
		const e = completo({
			genres: [
				{ slug: 'death-metal', name: 'Death Metal', path: 'metal.death-metal', isPrimary: true },
				{ slug: 'death', name: 'Death  metal', path: 'metal.death', isPrimary: false }
			]
		});
		const tag = hashtag(e);

		expect(tag.filter((t) => t === '#deathmetal')).toHaveLength(1);
	});
});
