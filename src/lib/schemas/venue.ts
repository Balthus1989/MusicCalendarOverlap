import { z } from 'zod';
import {
	emailOpzionale,
	interoOpzionale,
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
	// `interoOpzionale` e non `z.coerce.number()`: da un form la capienza non
	// compilata arriva come stringa vuota, che `coerce` trasformava in 0 —
	// bocciato dal minimo, con il risultato che un campo facoltativo era
	// obbligatorio. Chi non conosce la capienza del locale lascia vuoto.
	capacity: interoOpzionale(1, 500000).nullable().default(null),
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
