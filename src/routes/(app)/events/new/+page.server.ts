import { error, fail, redirect } from '@sveltejs/kit';
import { canCreateEvent } from '$lib/server/auth/permissions';
import { getDb } from '$lib/server/db/client';
import { validaEvento, valoriDaForm, valoriPredefiniti } from '$lib/server/events/form';
import { opzioniForm } from '$lib/server/events/queries';
import { motiviCheImpediscono, transizioniAmmesse } from '$lib/server/events/status';
import { llmConfigurato } from '$lib/server/parse/llm';
import { creaEvento } from '$lib/server/events/write';
import { daLocaleAIstante } from '$lib/time';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const viewer = locals.viewer;
	if (!viewer) error(401, 'Sessione non valida.');

	const { organizations } = await parent();
	if (!organizations.length) redirect(303, '/onboarding');

	const { locali, generi } = await opzioniForm(getDb());

	return {
		valori: valoriPredefiniti(organizations[0]),
		organizzazioni: organizations.map((o) => ({ id: o.id, name: o.name })),
		locali,
		generi,
		// Da una bozza si può già scegliere qualunque stato: capita di
		// inserire una data che è confermata da settimane.
		statiAmmessi: transizioniAmmesse('draft'),
		// Senza `LLM_API_KEY` il testo libero non si legge, ma `.ics` e CSV sì:
		// il pannello lo dice invece di offrire una funzione che non risponde
		// (Fase 5, ADR-0034).
		llmDisponibile: llmConfigurato()
	};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const viewer = locals.viewer;
		if (!viewer)
			return fail(401, { valori: null, errori: {}, erroreGenerale: 'Sessione non valida.' });

		const form = await request.formData();
		const valori = valoriDaForm(form);

		const esito = validaEvento(form);
		if (!esito.ok) {
			return fail(400, { valori, errori: esito.errori, erroreGenerale: esito.primo });
		}

		const dati = esito.dati;

		if (!canCreateEvent(viewer, dati.organizationId)) {
			return fail(403, {
				valori,
				errori: {},
				erroreGenerale: 'Puoi inserire date solo per le organizzazioni di cui fai parte.'
			});
		}

		// L'unico blocco del prodotto: uno stato che richiede dati che non ci
		// sono (vedi `status.ts`). Tutto il resto avvisa e lascia salvare.
		const motivi = motiviCheImpediscono(dati.status, {
			title: dati.title,
			city: dati.city,
			venueId: dati.venueId,
			startsAt: daLocaleAIstante(dati.startsAtLocal)
		});
		if (motivi.length) {
			return fail(400, {
				valori,
				errori: Object.fromEntries(motivi.map((m) => [m.campo, m.messaggio])),
				erroreGenerale: motivi[0].messaggio
			});
		}

		const id = await creaEvento(getDb(), viewer.profileId, dati);
		redirect(303, `/events/${id}`);
	}
};
