import { error, fail } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import {
	canEditCatalogEntry,
	canModerateCatalog,
	canVerifyCatalogEntry
} from '$lib/server/auth/permissions';
import { getDb } from '$lib/server/db/client';
import { artistGenres, artists, genres, profiles } from '$lib/server/db/schema';
import { setArtistGenres } from '$lib/server/catalog/artists';
import { normalizeName } from '$lib/server/text';
import { artistSchema } from '$lib/schemas/artist';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
	const { viewer } = await parent();
	const db = getDb();

	const righe = await db
		.select({ artist: artists, autore: profiles.displayName })
		.from(artists)
		.leftJoin(profiles, eq(profiles.id, artists.createdBy))
		.where(eq(artists.id, params.id))
		.limit(1);

	const riga = righe[0];
	if (!riga) error(404, 'Artista non trovato.');

	const generiAssegnati = await db
		.select({ slug: genres.slug, name: genres.name, isPrimary: artistGenres.isPrimary })
		.from(artistGenres)
		.innerJoin(genres, eq(genres.id, artistGenres.genreId))
		.where(eq(artistGenres.artistId, params.id));

	const tuttiIGeneri = await db
		.select({ slug: genres.slug, name: genres.name, depth: genres.depth })
		.from(genres)
		.orderBy(asc(genres.path));

	return {
		artist: riga.artist,
		autore: riga.autore,
		generiAssegnati,
		tuttiIGeneri,
		puoModificare: canEditCatalogEntry(viewer, {
			createdBy: riga.artist.createdBy,
			isVerified: riga.artist.isVerified
		}),
		puoVerificare: canVerifyCatalogEntry(viewer),
		puoModerare: canModerateCatalog(viewer)
	};
};

export const actions: Actions = {
	salva: async ({ request, params, locals }) => {
		const viewer = locals.viewer;
		if (!viewer) return fail(401, { error: 'Sessione non valida.' });

		const db = getDb();
		const esistente = await db
			.select({ createdBy: artists.createdBy, isVerified: artists.isVerified })
			.from(artists)
			.where(eq(artists.id, params.id))
			.limit(1);

		if (!esistente[0]) return fail(404, { error: 'Artista non trovato.' });
		if (!canEditCatalogEntry(viewer, esistente[0])) {
			return fail(403, {
				error: esistente[0].isVerified
					? 'Questa scheda è verificata: si modifica solo con il ruolo di moderatore.'
					: 'Questa scheda l’ha inserita un altro organizzatore.'
			});
		}

		const form = await request.formData();
		const parsed = artistSchema.safeParse({
			...Object.fromEntries(form),
			genreSlugs: form.getAll('genreSlugs').map(String)
		});

		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Dati non validi.' });
		}

		const d = parsed.data;
		await db
			.update(artists)
			.set({
				name: d.name,
				nameNormalized: normalizeName(d.name),
				mbid: d.mbid,
				country: d.country,
				city: d.city,
				formedYear: d.formedYear,
				bio: d.bio,
				websiteUrl: d.websiteUrl,
				instagramUrl: d.instagramUrl,
				facebookUrl: d.facebookUrl,
				bandcampUrl: d.bandcampUrl,
				spotifyUrl: d.spotifyUrl,
				youtubeUrl: d.youtubeUrl,
				soundcloudUrl: d.soundcloudUrl,
				bookingEmail: d.bookingEmail,
				bookingAgency: d.bookingAgency,
				updatedAt: new Date()
			})
			.where(eq(artists.id, params.id));

		await setArtistGenres(db, params.id, d.genreSlugs);
		return { salvato: true };
	},

	/** Marca la scheda come curata. Da lì in poi si tocca solo da moderatore. */
	verifica: async ({ request, params, locals }) => {
		const viewer = locals.viewer;
		if (!viewer) return fail(401, { error: 'Sessione non valida.' });
		if (!canVerifyCatalogEntry(viewer)) {
			return fail(403, { error: 'Serve il ruolo di moderatore.' });
		}

		const form = await request.formData();
		const nuovo = form.get('verificata') === '1';

		await getDb()
			.update(artists)
			.set({ isVerified: nuovo, updatedAt: new Date() })
			.where(eq(artists.id, params.id));

		return { verificaAggiornata: true };
	}
};
