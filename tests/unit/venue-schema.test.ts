/**
 * La capienza di un locale è facoltativa, e il caso che conta è quello che
 * un form HTML produce davvero: il campo lasciato vuoto arriva come stringa
 * vuota, non come chiave assente. Con `z.coerce.number()` quella stringa
 * diventava 0, il minimo la bocciava, e un campo facoltativo era di fatto
 * obbligatorio — chi non conosce la capienza non poteva salvare il locale.
 */
import { describe, expect, it } from 'vitest';
import { venueSchema } from '../../src/lib/schemas/venue';

/** Il minimo che il form manda sempre: nome, città, paese e coordinate. */
function localeBase(extra: Record<string, unknown> = {}) {
	return {
		name: 'Sala Prove Del Boldro',
		city: 'Perugia',
		country: 'IT',
		lat: 43.1107,
		lon: 12.3908,
		...extra
	};
}

describe('capienza del locale', () => {
	it('resta nulla quando il form manda il campo vuoto', () => {
		const r = venueSchema.safeParse(localeBase({ capacity: '' }));
		expect(r.success).toBe(true);
		expect(r.success && r.data.capacity).toBeNull();
	});

	it('resta nulla anche con soli spazi, o senza la chiave', () => {
		expect(venueSchema.parse(localeBase({ capacity: '   ' })).capacity).toBeNull();
		expect(venueSchema.parse(localeBase()).capacity).toBeNull();
	});

	it('accetta un numero valido', () => {
		expect(venueSchema.parse(localeBase({ capacity: '200' })).capacity).toBe(200);
	});

	it('rifiuta ancora zero e i valori fuori scala', () => {
		for (const capacity of ['0', '-5', '999999', 'boh']) {
			expect(venueSchema.safeParse(localeBase({ capacity })).success).toBe(false);
		}
	});
});
