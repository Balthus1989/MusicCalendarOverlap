/**
 * Segnalare la data di un organizzatore non iscritto (ADR-0044).
 *
 * La rotta sta dentro `(app)`: solo un iscritto segnala, ed è ciò che tiene la
 * funzione fuori da tutte le questioni che il percorso pubblico avrebbe aperto
 * — nessuna rotta pubblica in scrittura, nessun canale da riaprire, nessun
 * indirizzo IP da leggere per contare i tentativi.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { canReportExternalEvent } from '$lib/server/auth/permissions';
import { getDb } from '$lib/server/db/client';
import { creaSegnalazione } from '$lib/server/events/segnalazioni';
import { opzioniForm } from '$lib/server/events/queries';
import { segnalazioneSchema } from '$lib/schemas/segnalazione';
import { formValues } from '$lib/server/forms';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const viewer = locals.viewer;
	if (!viewer) error(401, 'Sessione non valida.');

	const { organizations } = await parent();
	if (!organizations.length) redirect(303, '/onboarding');

	const { locali, generi } = await opzioniForm(getDb());

	return {
		organizzazioni: organizations.map((o) => ({ id: o.id, name: o.name })),
		locali,
		generi
	};
};

/**
 * I nomi delle band arrivano da una `textarea`, uno per riga: è la forma in cui
 * si incolla una locandina, e chi segnala la data di un altro non sta
 * compilando una lineup — sta riferendo dei nomi.
 */
function nomiDaTextarea(valore: string): string[] {
	return valore
		.split('\n')
		.map((r) => r.trim())
		.filter(Boolean);
}

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const viewer = locals.viewer;
		const vuoti: Record<string, string> = {};
		if (!viewer)
			return fail(401, { valori: vuoti, errori: vuoti, erroreGenerale: 'Sessione non valida.' });

		const form = await request.formData();
		const valori = formValues(form);

		if (!canReportExternalEvent(viewer)) {
			return fail(403, {
				valori,
				errori: vuoti,
				erroreGenerale: 'Per segnalare una data devi appartenere a un’organizzazione.'
			});
		}

		const parsed = segnalazioneSchema.safeParse({
			...valori,
			lineup: nomiDaTextarea(valori.lineup ?? '')
		});

		if (!parsed.success) {
			const errori: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const chiave = issue.path.join('.') || 'form';
				if (!(chiave in errori)) errori[chiave] = issue.message;
			}
			return fail(400, {
				valori,
				errori,
				erroreGenerale: Object.values(errori)[0] ?? 'Dati non validi.'
			});
		}

		// Si segnala **con** una delle proprie organizzazioni, e la firma
		// compare in calendario: non si segnala a nome di un circolo di cui
		// non si fa parte.
		if (!(parsed.data.segnalataDaOrganizationId in viewer.roles)) {
			return fail(403, {
				valori,
				errori: vuoti,
				erroreGenerale: 'Puoi segnalare solo a nome di un’organizzazione di cui fai parte.'
			});
		}

		const esito = await creaSegnalazione(getDb(), viewer.profileId, parsed.data);

		if (!esito.ok) {
			return fail(409, {
				valori,
				errori: { organizzatore: `${esito.nome} è già iscritta al calendario.` },
				erroreGenerale:
					`${esito.nome} è già iscritta al calendario: le sue date le carica lei, ` +
					'e segnalarle da qui creerebbe un doppione che nessuno può correggere.'
			});
		}

		redirect(303, `/events/${esito.eventId}`);
	}
};
