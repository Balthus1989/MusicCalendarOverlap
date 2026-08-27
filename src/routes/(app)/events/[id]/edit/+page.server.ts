import { error, fail, redirect } from '@sveltejs/kit';
import { autorizzabile, canEditEvent } from '$lib/server/auth/permissions';
import { getDb } from '$lib/server/db/client';
import { validaEvento, valoriDaEvento, valoriDaForm } from '$lib/server/events/form';
import { caricaEventoPerModifica, opzioniForm } from '$lib/server/events/queries';
import { motiviCheImpediscono, puoTransire, transizioniAmmesse } from '$lib/server/events/status';
import { aggiornaEvento } from '$lib/server/events/write';
import { daLocaleAIstante } from '$lib/time';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, parent }) => {
	const viewer = locals.viewer;
	if (!viewer) error(401, 'Sessione non valida.');

	const db = getDb();
	const evento = await caricaEventoPerModifica(db, params.id);
	// Un evento che non si può modificare risponde 404 e non 403: dire "esiste
	// ma non è tuo" su una bozza altrui sarebbe già dire troppo.
	if (!evento || !canEditEvent(viewer, autorizzabile(evento))) error(404, 'Data non trovata.');

	const { organizations } = await parent();
	const { locali, generi } = await opzioniForm(db);

	return {
		valori: valoriDaEvento(evento),
		titolo: evento.title,
		organizzazioni: organizations.map((o) => ({ id: o.id, name: o.name })),
		locali,
		generi,
		statiAmmessi: transizioniAmmesse(evento.status)
	};
};

export const actions: Actions = {
	default: async ({ request, locals, params }) => {
		const viewer = locals.viewer;
		if (!viewer)
			return fail(401, { valori: null, errori: {}, erroreGenerale: 'Sessione non valida.' });

		const db = getDb();
		const precedente = await caricaEventoPerModifica(db, params.id);
		if (!precedente || !canEditEvent(viewer, autorizzabile(precedente)))
			error(404, 'Data non trovata.');

		const form = await request.formData();
		const valori = valoriDaForm(form);

		const esito = validaEvento(form);
		if (!esito.ok) {
			return fail(400, { valori, errori: esito.errori, erroreGenerale: esito.primo });
		}

		const dati = esito.dati;

		// L'organizzazione proprietaria non si cambia da qui: una data che
		// passa a un'altra associazione cambierebbe chi la vede e chi la può
		// modificare, e non è un'operazione da campo nascosto di un form.
		if (dati.organizationId !== precedente.organizationId) {
			return fail(400, {
				valori,
				errori: {},
				erroreGenerale: 'Una data non si sposta fra organizzazioni.'
			});
		}

		if (!puoTransire(precedente.status, dati.status)) {
			return fail(400, {
				valori,
				errori: {
					status:
						'Una data già vista dalle altre organizzazioni non può tornare in bozza. Se non si fa più, annullala.'
				},
				erroreGenerale: 'Questo cambio di stato non è ammesso.'
			});
		}

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

		await aggiornaEvento(db, viewer.profileId, params.id, dati, {
			status: precedente.status,
			title: precedente.title,
			startsAt: precedente.startsAt,
			venueId: precedente.venueId
		});

		redirect(303, `/events/${params.id}`);
	}
};
