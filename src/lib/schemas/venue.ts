import { z } from 'zod';
import {
	emailOpzionale,
	latitudine,
	longitudine,
	paese,
	provinciaOpzionale,
	testoOpzionale,
	urlOpzionale
} from './common';

export const venueSchema = z.object({
	name: z.string().trim().min(2, 'Il nome del locale è obbligatorio.').max(160),
	address: testoOpzionale(240),
	city: z.string().trim().min(2, 'La città è obbligatoria.').max(120),
	province: provinciaOpzionale,
	region: testoOpzionale(120),
	postalCode: testoOpzionale(16),
	country: paese,
	// Obbligatorie: un venue senza coordinate non entra nel calcolo conflitti,
	// che è la ragione per cui il venue sta in anagrafica (ADR-0008).
	lat: latitudine,
	lon: longitudine,
	capacity: z.coerce
		.number()
		.int()
		.min(1, 'La capienza è almeno 1.')
		.max(500000)
		.nullable()
		.default(null),
	website: urlOpzionale,
	instagramUrl: urlOpzionale,
	facebookUrl: urlOpzionale,
	phone: testoOpzionale(40),
	email: emailOpzionale,
	/** Es. "palco piccolo, no backline". */
	notes: testoOpzionale(2000),
	/** Tracciabilità: da quale query sono uscite le coordinate. */
	geocodeQuery: testoOpzionale(300),
	geocodeSource: testoOpzionale(40)
});

export type VenueInput = z.infer<typeof venueSchema>;
