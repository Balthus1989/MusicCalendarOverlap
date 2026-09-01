/**
 * L'anagrafica di una band, dal lato di ciò che un form HTML manda davvero.
 *
 * È lo stesso caso di `venue-schema.test.ts`, e non è un caso che si ripeta:
 * un campo numerico facoltativo lasciato vuoto arriva come **stringa vuota**,
 * non come chiave assente. Con `z.coerce.number()` quella stringa diventa 0,
 * il minimo la boccia con «Anno troppo remoto», e un campo dichiarato
 * facoltativo diventa obbligatorio. Su `venues.capacity` era stato corretto,
 * su `artists.formedYear` era rimasto — dalla Fase 1 non si poteva inserire
 * né modificare una band di cui non si conosce l'anno di formazione.
 *
 * I fatti dichiarati della scheda operativa (Fase 7) hanno la stessa forma e
 * sono qui sotto per non ripetere la storia una terza volta.
 */
import { describe, expect, it } from 'vitest';
import { artistSchema } from '../../src/lib/schemas/artist';

/** Il minimo che il form manda sempre: solo il nome è obbligatorio. */
function bandBase(extra: Record<string, unknown> = {}) {
	return { name: 'Le Ore Contate', ...extra };
}

describe('anno di formazione', () => {
	it('resta nullo quando il form manda il campo vuoto', () => {
		const r = artistSchema.safeParse(bandBase({ formedYear: '' }));
		expect(r.success).toBe(true);
		if (r.success) expect(r.data.formedYear).toBeNull();
	});

	it('resta nullo quando la chiave non c’è affatto', () => {
		const r = artistSchema.safeParse(bandBase());
		expect(r.success).toBe(true);
		if (r.success) expect(r.data.formedYear).toBeNull();
	});

	it('accetta un anno vero', () => {
		const r = artistSchema.safeParse(bandBase({ formedYear: '1998' }));
		expect(r.success).toBe(true);
		if (r.success) expect(r.data.formedYear).toBe(1998);
	});

	it('rifiuta un anno davvero fuori scala', () => {
		expect(artistSchema.safeParse(bandBase({ formedYear: '1723' })).success).toBe(false);
	});
});

describe('i fatti dichiarati della scheda operativa', () => {
	it('sono tutti facoltativi, e il vuoto vale «non lo sappiamo»', () => {
		const r = artistSchema.safeParse(
			bandBase({
				volumeAttrezzatura: '',
				personeInViaggio: '',
				richiedeBackline: '',
				durataSetMaxDichiarata: ''
			})
		);
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.volumeAttrezzatura).toBeNull();
			expect(r.data.personeInViaggio).toBeNull();
			expect(r.data.durataSetMaxDichiarata).toBeNull();
			// Il terzo stato è voluto: `null` non è «no», è «non lo sappiamo».
			expect(r.data.richiedeBackline).toBeNull();
		}
	});

	it('leggono i tre stati della backline, e non due', () => {
		const si = artistSchema.safeParse(bandBase({ richiedeBackline: 'si' }));
		const no = artistSchema.safeParse(bandBase({ richiedeBackline: 'no' }));
		expect(si.success && si.data.richiedeBackline).toBe(true);
		expect(no.success && no.data.richiedeBackline).toBe(false);
	});

	it('accettano la scala chiusa del volume e rifiutano il resto', () => {
		expect(artistSchema.safeParse(bandBase({ volumeAttrezzatura: 'furgone' })).success).toBe(true);
		expect(artistSchema.safeParse(bandBase({ volumeAttrezzatura: 'tir' })).success).toBe(false);
	});

	it('non ammettono un cachet: il prezzo non è un campo della band', () => {
		// Non è una verifica di validazione ma di forma: se un giorno qualcuno
		// aggiungesse un prezzo qui, questa asserzione cade ed è il posto
		// giusto in cui accorgersene (ADR-0048).
		const r = artistSchema.safeParse(bandBase({ cachet: '1200', fasciaCachet: '600_1200' }));
		expect(r.success).toBe(true);
		if (r.success) {
			expect(Object.keys(r.data)).not.toContain('cachet');
			expect(Object.keys(r.data)).not.toContain('fasciaCachet');
		}
	});
});
