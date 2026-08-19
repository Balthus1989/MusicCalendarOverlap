import { z } from 'zod';
import { emailOpzionale, testoOpzionale, urlOpzionale } from './common';

const ANNO_CORRENTE = new Date().getUTCFullYear();

export const artistSchema = z.object({
	name: z.string().trim().min(1, 'Il nome della band è obbligatorio.').max(200),
	/**
	 * MusicBrainz ID. È la chiave di deduplica forte: quando c'è, due omonimi
	 * restano distinguibili e l'indice unico sul nome normalizzato non si
	 * applica (ADR-0006).
	 */
	mbid: z
		.string()
		.trim()
		.transform((v) => (v === '' ? null : v))
		.nullable()
		.default(null)
		.refine((v) => v === null || z.uuid().safeParse(v).success, 'Un MusicBrainz ID è un UUID.'),
	country: testoOpzionale(2),
	city: testoOpzionale(120),
	formedYear: z.coerce
		.number()
		.int()
		.min(1900, 'Anno troppo remoto.')
		.max(ANNO_CORRENTE, 'Anno nel futuro.')
		.nullable()
		.default(null),
	bio: testoOpzionale(4000),
	websiteUrl: urlOpzionale,
	instagramUrl: urlOpzionale,
	facebookUrl: urlOpzionale,
	bandcampUrl: urlOpzionale,
	spotifyUrl: urlOpzionale,
	youtubeUrl: urlOpzionale,
	soundcloudUrl: urlOpzionale,
	/** Informazione preziosa fra organizzatori: è metà del senso dell'anagrafica. */
	bookingEmail: emailOpzionale,
	bookingAgency: testoOpzionale(160),
	/** Slug dei generi; il primo è il primario. */
	genreSlugs: z.array(z.string()).max(6, 'Al massimo sei generi per band.').default([])
});

export type ArtistInput = z.infer<typeof artistSchema>;
