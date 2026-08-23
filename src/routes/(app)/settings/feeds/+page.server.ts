import { error, fail } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import { getDb } from '$lib/server/db/client';
import { opzioniFiltri } from '$lib/server/events/queries';
import { creaFeed, elencaFeed, revocaFeed } from '$lib/server/feeds/service';
import { geocode } from '$lib/server/geocode';
import { formValues, valoriMultipli } from '$lib/server/forms';
import { feedSchema, STATI_FEED_PREDEFINITI, type FiltriFeed } from '$lib/schemas/feed';
import type { Actions, PageServerLoad } from './$types';

/** Appiattisce le issue Zod in `campo → messaggio`, come gli altri form (ADR-0017). */
function validaFeed(dati: unknown) {
	const esito = feedSchema.safeParse(dati);
	if (esito.success) return { ok: true as const, dati: esito.data };

	const errori: Record<string, string> = {};
	for (const issue of esito.error.issues) {
		const chiave = issue.path.join('.');
		if (!errori[chiave]) errori[chiave] = issue.message;
	}
	return { ok: false as const, errori };
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const viewer = locals.viewer;
	const profile = locals.profile;
	if (!viewer || !profile) error(401, 'Sessione non valida.');

	const db = getDb();
	const { generi, organizzazioni } = await opzioniFiltri(db);

	return {
		feeds: await elencaFeed(db, profile.id),
		generi,
		organizzazioni,
		// La radice con cui si compone l'URL da incollare in Google Calendar.
		// Viene dal server perché in produzione `PUBLIC_APP_URL` è il nome
		// pubblico, che non coincide con l'origine da cui arriva la richiesta.
		baseUrl: (publicEnv.PUBLIC_APP_URL ?? url.origin).replace(/\/+$/, '')
	};
};

export const actions: Actions = {
	crea: async ({ request, locals }) => {
		const profile = locals.profile;
		if (!profile) return fail(401, { errore: 'Sessione non valida.' });

		const form = await request.formData();
		const valori = formValues(form);
		const esito = validaFeed({
			...valori,
			generi: valoriMultipli(form, 'generi'),
			stati: valoriMultipli(form, 'stati'),
			organizzazioni: valoriMultipli(form, 'organizzazioni')
		});

		if (!esito.ok) return fail(400, { valori, errori: esito.errori });

		const dati = esito.dati;
		const db = getDb();

		// Il centro si risolve **una volta sola**, adesso: un client calendario
		// interroga il feed ogni dodici ore, e geocodificare a ogni richiesta
		// brucerebbe il rate limit di Photon per un dato che non cambia mai.
		let centro: FiltriFeed['centro'] = null;
		if (dati.centroCitta) {
			try {
				const punto = await geocode(db, dati.centroCitta);
				if (punto) centro = { citta: dati.centroCitta, lat: punto.lat, lon: punto.lon };
			} catch (err) {
				// Degradazione elegante (principio 5): il geocoding assente
				// costa il filtro geografico, non il feed.
				console.error('Centro del feed non geocodificato:', err);
			}
		}

		if (dati.centroCitta && !centro) {
			const errori: Record<string, string> = {
				centroCitta:
					'Non sono riuscito a trovare questa città. Lasciala vuota per un feed senza filtro di distanza.'
			};
			return fail(400, { valori, errori });
		}

		const filtri: FiltriFeed = {
			generi: dati.generi,
			stati: dati.stati.length ? dati.stati : STATI_FEED_PREDEFINITI,
			organizzazioni: dati.organizzazioni,
			// Un raggio senza centro non filtra niente: si scarta invece di
			// salvarlo, così l'interfaccia non mostra un filtro che non agisce.
			raggioKm: centro ? dati.raggioKm : null,
			centro
		};

		const feed = await creaFeed(db, profile.id, dati.label, filtri);
		return { creato: feed.token };
	},

	revoca: async ({ request, locals }) => {
		const profile = locals.profile;
		if (!profile) return fail(401, { errore: 'Sessione non valida.' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { errore: 'Feed non indicato.' });

		const fatto = await revocaFeed(getDb(), profile.id, id);
		if (!fatto) return fail(404, { errore: 'Feed non trovato, o già disdetto.' });

		return { revocato: true };
	}
};
