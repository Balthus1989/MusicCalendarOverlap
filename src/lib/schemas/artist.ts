import { z } from 'zod';
import {
	emailOpzionale,
	enumOpzionale,
	interoOpzionale,
	testoOpzionale,
	urlOpzionale
} from './common';

const ANNO_CORRENTE = new Date().getUTCFullYear();

/**
 * Quanto spazio serve per scaricare. Scala chiusa e ordinata: due band si
 * confrontano solo se la scala è la stessa, ed è la stessa che si usa per il
 * volume osservato su una singola serata.
 */
export const VOLUMI = [
	'solo_voce',
	'acustico',
	'backline_leggera',
	'furgone',
	'furgone_grande',
	'camion'
] as const;

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

	/*
	 * Fatti dichiarati (ADR-0048): descrivono la band a prescindere da chi la
	 * ingaggia, si leggono da un rider e si curano come il contatto booking.
	 * Nessuno di questi è un prezzo e nessuno è un giudizio.
	 */
	volumeAttrezzatura: enumOpzionale(VOLUMI),
	personeInViaggio: interoOpzionale(1, 60),
	/** Terzo stato voluto: `null` è "non lo sappiamo", che non è "no". */
	richiedeBackline: z
		.union([z.string(), z.null()])
		.optional()
		.transform((v) => (v === 'si' ? true : v === 'no' ? false : null)),
	durataSetMaxDichiarata: interoOpzionale(1, 600),

	/** Slug dei generi; il primo è il primario. */
	genreSlugs: z.array(z.string()).max(6, 'Al massimo sei generi per band.').default([])
});

export type ArtistInput = z.infer<typeof artistSchema>;
