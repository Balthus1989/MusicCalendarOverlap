import { error, fail } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import {
	canEditCatalogEntry,
	canEditOsservazione,
	canModerateCatalog,
	canSpegnereScheda,
	canVerifyCatalogEntry,
	canWriteRiferita
} from '$lib/server/auth/permissions';
import { getDb } from '$lib/server/db/client';
import { artistGenres, artists, genres, profiles } from '$lib/server/db/schema';
import { setArtistGenres } from '$lib/server/catalog/artists';
import {
	cancellaOsservazione,
	cancellaOsservazioniDi,
	impostaSchedaSpenta,
	leggiSchedaGrezza,
	proprietarioOsservazione,
	scriviRiferita
} from '$lib/server/catalog/osservazioni';
import { serializeArtistCard } from '$lib/server/visibility';
import { normalizeName } from '$lib/server/text';
import { artistSchema } from '$lib/schemas/artist';
import { riferitaSchema } from '$lib/schemas/osservazione';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
	const { viewer, organizations } = await parent();
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

	// La scheda operativa non esce mai grezza: `serializeArtistCard` restituisce
	// `null` sia quando la band ha chiesto di spegnerla sia — non è il caso qui
	// — quando non c'è niente da mostrare (ADR-0048).
	const grezza = await leggiSchedaGrezza(db, params.id);
	const scheda = grezza ? serializeArtistCard(grezza, viewer) : null;

	return {
		artist: riga.artist,
		autore: riga.autore,
		generiAssegnati,
		tuttiIGeneri,
		scheda,
		organizzazioni: organizations.map((o) => ({ id: o.id, name: o.name })),
		puoModificare: canEditCatalogEntry(viewer, {
			createdBy: riga.artist.createdBy,
			isVerified: riga.artist.isVerified
		}),
		puoVerificare: canVerifyCatalogEntry(viewer),
		puoModerare: canModerateCatalog(viewer),
		puoRiferire: canWriteRiferita(viewer),
		puoSpegnere: canSpegnereScheda(viewer)
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
				volumeAttrezzatura: d.volumeAttrezzatura,
				personeInViaggio: d.personeInViaggio,
				richiedeBackline: d.richiedeBackline,
				durataSetMaxDichiarata: d.durataSetMaxDichiarata,
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
	},

	/**
	 * Il sentito dire, per una band che nel gruppo non ha ancora portato
	 * nessuno. Una per organizzazione, sostituibile: il vincolo sta
	 * sull'indice parziale, e riscrivere è la cosa che ci si aspetta.
	 */
	riferisci: async ({ request, params, locals }) => {
		const viewer = locals.viewer;
		if (!viewer) return fail(401, { error: 'Sessione non valida.' });
		if (!canWriteRiferita(viewer)) {
			return fail(403, { error: 'Serve appartenere a un’organizzazione.' });
		}

		const form = await request.formData();
		const parsed = riferitaSchema.safeParse({
			...Object.fromEntries(form),
			artistId: params.id
		});
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Dati non validi.' });
		}

		const organizationId = String(form.get('organizationId') ?? '');
		// La riferita è dell'organizzazione, non della persona: senza una
		// firma valida non si scrive, perché il conteggio delle organizzazioni
		// è metà della soglia di ADR-0049.
		if (!viewer.roles[organizationId]) {
			return fail(403, { error: 'Scegli una delle tue organizzazioni.' });
		}

		const db = getDb();
		const band = await db
			.select({ schedaSpenta: artists.schedaSpenta })
			.from(artists)
			.where(eq(artists.id, params.id))
			.limit(1);
		if (!band[0]) return fail(404, { error: 'Band non trovata.' });
		if (band[0].schedaSpenta) {
			return fail(403, { error: 'Questa band ha chiesto di non avere una scheda operativa.' });
		}

		const d = parsed.data;
		await scriviRiferita(db, params.id, organizationId, viewer.profileId, d.annoRiferimento, {
			fasciaCachet: d.fasciaCachet,
			cachetInclude: d.cachetInclude,
			durataSetMinuti: d.durataSetMinuti,
			volumeOsservato: d.volumeOsservato
		});

		return { osservazioneSalvata: true };
	},

	/** Ritira una propria osservazione. Si cancella davvero: è una riga, non c'è altro. */
	ritira: async ({ request, locals }) => {
		const viewer = locals.viewer;
		if (!viewer) return fail(401, { error: 'Sessione non valida.' });

		const form = await request.formData();
		const id = String(form.get('osservazioneId') ?? '');
		const db = getDb();

		const proprietario = await proprietarioOsservazione(db, id);
		if (!proprietario) return fail(404, { error: 'Osservazione non trovata.' });
		if (!canEditOsservazione(viewer, proprietario)) {
			return fail(403, { error: 'Questa osservazione è di un’altra organizzazione.' });
		}

		await cancellaOsservazione(db, id);
		return { osservazioneRitirata: true };
	},

	/**
	 * Spegne o riaccende la scheda su richiesta della band (ADR-0051).
	 *
	 * **Spegnere non cancella**, ed è voluto: chi si oppone di solito non vuole
	 * sparire, vuole che non si parli del suo prezzo. Chi invece chiede la
	 * cancellazione passa dall'azione qui sotto, che è un'altra cosa e ha un
	 * altro pulsante.
	 */
	scheda: async ({ request, params, locals }) => {
		const viewer = locals.viewer;
		if (!viewer) return fail(401, { error: 'Sessione non valida.' });
		if (!canSpegnereScheda(viewer)) {
			return fail(403, { error: 'Serve il ruolo di moderatore.' });
		}

		const form = await request.formData();
		await impostaSchedaSpenta(getDb(), params.id, form.get('spenta') === '1');
		return { schedaAggiornata: true };
	},

	/**
	 * Cancella davvero le annotazioni su una band (art. 17, ADR-0051).
	 *
	 * Si può solo su una scheda **già spenta**: la cancellazione è irreversibile
	 * e cancella righe di altre organizzazioni, quindi non deve essere a un clic
	 * di distanza da chi stava facendo un'altra cosa. Spegnere prima è anche
	 * l'ordine giusto nel merito — l'opposizione ferma il trattamento, la
	 * cancellazione lo rimuove.
	 */
	cancellaAnnotazioni: async ({ params, locals }) => {
		const viewer = locals.viewer;
		if (!viewer) return fail(401, { error: 'Sessione non valida.' });
		if (!canSpegnereScheda(viewer)) {
			return fail(403, { error: 'Serve il ruolo di moderatore.' });
		}

		const db = getDb();
		const band = await db
			.select({ schedaSpenta: artists.schedaSpenta })
			.from(artists)
			.where(eq(artists.id, params.id))
			.limit(1);
		if (!band[0]) return fail(404, { error: 'Band non trovata.' });
		if (!band[0].schedaSpenta) {
			return fail(400, {
				error:
					'Spegni prima la scheda: la cancellazione è definitiva e riguarda anche le righe di altre organizzazioni.'
			});
		}

		const quante = await cancellaOsservazioniDi(db, params.id);
		return { annotazioniCancellate: quante };
	}
};
