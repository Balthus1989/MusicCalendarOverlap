/**
 * Token e filtri dei feed ICS (ARCHITECTURE.md §8, ADR-0011, ADR-0029).
 *
 * Il token è l'unica cosa che protegge un endpoint pubblico che restituisce
 * dati di dominio. I filtri sono l'unica parte configurabile del feed, e la
 * proprietà che conta di loro è negativa: **non possono allargare** ciò che il
 * profilo già vede.
 */
import { describe, expect, it } from 'vitest';
import {
	FILTRI_VUOTI,
	feedSchema,
	filtriFeed,
	leggiFiltri,
	statoFeed,
	STATI_FEED_PREDEFINITI
} from '../../src/lib/schemas/feed';
import { finestraFeed, MESI_AVANTI, MESI_INDIETRO } from '../../src/lib/server/feeds/service';
import {
	generaTokenFeed,
	LUNGHEZZA_TOKEN,
	tokenBenFormato
} from '../../src/lib/server/feeds/token';

describe('token', () => {
	it('è lungo 32 caratteri e sta in un URL senza essere codificato', () => {
		for (let i = 0; i < 50; i++) {
			const t = generaTokenFeed();
			expect(t).toHaveLength(LUNGHEZZA_TOKEN);
			expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
			expect(encodeURIComponent(t)).toBe(t);
		}
	});

	it('non si ripete', () => {
		const visti = new Set(Array.from({ length: 500 }, generaTokenFeed));
		expect(visti.size).toBe(500);
	});

	it('riconosce la forma, e non è un controllo di sicurezza', () => {
		expect(tokenBenFormato(generaTokenFeed())).toBe(true);
		expect(tokenBenFormato('troppo-corto')).toBe(false);
		expect(tokenBenFormato('a'.repeat(31))).toBe(false);
		// Un carattere fuori alfabeto: quasi sempre un percorso di scanner.
		expect(tokenBenFormato('a'.repeat(31) + '/')).toBe(false);
	});
});

describe('filtri', () => {
	it('senza niente di scritto, un feed contiene tutto ciò che il profilo vede', () => {
		expect(leggiFiltri(null)).toEqual(FILTRI_VUOTI);
		expect(leggiFiltri({})).toEqual(FILTRI_VUOTI);
	});

	it('una colonna illeggibile degrada a “nessun filtro”, non fa fallire il feed', () => {
		// Un calendario che smette di aggiornarsi è un guasto che nessuno nota
		// per settimane: meglio un feed più largo di uno rotto.
		expect(leggiFiltri({ stati: ['inventato'] })).toEqual(FILTRI_VUOTI);
		expect(leggiFiltri('non è nemmeno un oggetto')).toEqual(FILTRI_VUOTI);
	});

	it('un feed salvato prima che un campo esistesse continua a funzionare', () => {
		const vecchio = leggiFiltri({ generi: ['metal'] });
		expect(vecchio.generi).toEqual(['metal']);
		expect(vecchio.stati).toEqual(STATI_FEED_PREDEFINITI);
		expect(vecchio.centro).toBeNull();
	});

	it('le bozze non sono uno stato ammesso, e non lo diventano per errore', () => {
		// ADR-0029: una bozza è la sola cosa di cui il prodotto promette che
		// nessun altro l'ha vista, e un feed vive su un endpoint pubblico.
		expect(statoFeed.safeParse('draft').success).toBe(false);
		expect(STATI_FEED_PREDEFINITI).not.toContain('draft');
		expect(filtriFeed.safeParse({ stati: ['draft'] }).success).toBe(false);
	});

	it('accetta i tre stati che un feed può contenere', () => {
		for (const s of ['hold', 'confirmed', 'cancelled']) {
			expect(statoFeed.safeParse(s).success).toBe(true);
		}
	});
});

describe('form di creazione', () => {
	it('pretende un nome: fra sei mesi ce ne sono tre e vanno distinti', () => {
		expect(feedSchema.safeParse({ label: '  ' }).success).toBe(false);
	});

	it('senza stati spuntati riporta al default invece di salvare un feed vuoto', () => {
		const out = feedSchema.parse({ label: 'Tutto', stati: [] });
		expect(out.stati).toEqual(STATI_FEED_PREDEFINITI);
	});

	it('la città vuota vale “nessun centro”, non la stringa vuota', () => {
		const out = feedSchema.parse({ label: 'Tutto', centroCitta: '' });
		expect(out.centroCitta).toBeNull();
	});

	it('rifiuta un raggio fuori scala', () => {
		expect(feedSchema.safeParse({ label: 'x', raggioKm: '0' }).success).toBe(false);
		expect(feedSchema.safeParse({ label: 'x', raggioKm: '9000' }).success).toBe(false);
		expect(feedSchema.parse({ label: 'x', raggioKm: '60' }).raggioKm).toBe(60);
	});
});

describe('finestra temporale', () => {
	it('guarda indietro quanto basta a tenere lo storico, avanti quanto il ricalcolo notturno', () => {
		const adesso = new Date('2026-09-01T00:00:00Z');
		const { da, a } = finestraFeed(adesso);

		expect(da.getUTCMonth()).toBe((9 - 1 - MESI_INDIETRO + 12) % 12);
		expect(a < new Date('2028-04-01T00:00:00Z')).toBe(true);
		expect(MESI_AVANTI).toBe(18);
		expect(da < adesso && adesso < a).toBe(true);
	});
});
