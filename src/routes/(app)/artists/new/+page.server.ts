import { fail, redirect } from '@sveltejs/kit';
import { formValues } from '$lib/server/forms';
import { asc } from 'drizzle-orm';
import { getDb } from '$lib/server/db/client';
import { artists, genres } from '$lib/server/db/schema';
import { findDuplicates, setArtistGenres } from '$lib/server/catalog/artists';
import { normalizeName } from '$lib/server/text';
import { artistSchema } from '$lib/schemas/artist';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const elenco = await getDb()
		.select({ slug: genres.slug, name: genres.name, depth: genres.depth, path: genres.path })
		.from(genres)
		.orderBy(asc(genres.path));

	return { generi: elenco };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const viewer = locals.viewer;
		if (!viewer) return fail(401, { error: 'Sessione non valida.' });

		const form = await request.formData();
		const grezzi = formValues(form);
		const parsed = artistSchema.safeParse({
			...grezzi,
			genreSlugs: form.getAll('genreSlugs').map(String)
		});

		// Tutti i `fail` di questa action condividono la stessa forma: altrimenti
		// il tipo di `form` nel componente diventa un'unione e l'accesso a un
		// campo presente solo in un ramo non compila.
		const vuoto = {
			doppioni: [] as Awaited<ReturnType<typeof findDuplicates>>,
			vaiA: null as string | null,
			error: null as string | null,
			valori: grezzi
		};

		if (!parsed.success) {
			return fail(400, {
				...vuoto,
				error: parsed.error.issues[0]?.message ?? 'Dati non validi.',
				valori: grezzi
			});
		}

		const d = parsed.data;
		const db = getDb();

		// Deduplica: un match su MBID è certo e blocca, il resto avvisa.
		const doppioni = await findDuplicates(db, d.name, d.mbid);
		const certo = doppioni.find((x) => x.motivo === 'mbid');
		if (certo) {
			return fail(409, {
				...vuoto,
				error: `Questo MusicBrainz ID è già in anagrafica, sotto il nome "${certo.name}".`,
				vaiA: certo.id,
				valori: grezzi
			});
		}
		if (doppioni.length && form.get('confermaDoppione') !== '1') {
			return fail(409, { ...vuoto, doppioni, valori: grezzi, error: null });
		}

		const nameNormalized = normalizeName(d.name);

		// L'indice unique parziale su `name_normalized` (dove mbid è null) può
		// far fallire l'insert anche dopo il controllo sopra, per una scrittura
		// concorrente. Il messaggio dev'essere comprensibile, non un 500.
		let creatoId: string;
		try {
			const creato = await db
				.insert(artists)
				.values({
					name: d.name,
					nameNormalized,
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
					volumeAttrezzatura: d.volumeAttrezzatura,
					personeInViaggio: d.personeInViaggio,
					richiedeBackline: d.richiedeBackline,
					durataSetMaxDichiarata: d.durataSetMaxDichiarata,
					createdBy: viewer.profileId
				})
				.returning({ id: artists.id });
			creatoId = creato[0].id;
		} catch (err) {
			console.error('Inserimento artista fallito:', err);
			return fail(409, {
				...vuoto,
				error:
					'Esiste già una band con questo nome senza MusicBrainz ID. Se è davvero un’altra band, collegala a MusicBrainz per distinguerla.',
				valori: grezzi
			});
		}

		await setArtistGenres(db, creatoId, d.genreSlugs);

		redirect(303, `/artists/${creatoId}`);
	}
};
