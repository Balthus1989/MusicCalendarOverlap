import { error, fail, redirect } from '@sveltejs/kit';
import { canDeleteEvent, canEditEvent } from '$lib/server/auth/permissions';
import { conflittiDellEvento } from '$lib/server/conflicts/queries';
import { getDb } from '$lib/server/db/client';
import { caricaEvento } from '$lib/server/events/queries';
import {
	descriviTransizione,
	motiviCheImpediscono,
	puoTransire,
	transizioniAmmesse
} from '$lib/server/events/status';
import { cambiaStato, eliminaEvento } from '$lib/server/events/write';
import { serializeEvent } from '$lib/server/visibility';
import { statoEvento } from '$lib/schemas/event';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const viewer = locals.viewer;
	if (!viewer) error(401, 'Sessione non valida.');

	const db = getDb();
	const evento = await caricaEvento(db, params.id);
	if (!evento) error(404, 'Data non trovata.');

	// Il serializzatore è l'unica via d'uscita dei dati (ADR-0005). Un `null`
	// qui significa "per questo viewer non esiste": 404, non 403.
	const serializzato = serializeEvent(evento, viewer);
	if (!serializzato) error(404, 'Data non trovata.');

	const puoModificare = canEditEvent(viewer, evento);

	return {
		evento: serializzato,
		puoModificare,
		puoEliminare: canDeleteEvent(viewer, evento),
		transizioni: puoModificare ? transizioniAmmesse(evento.status) : [],
		// ADR-0022 non mette nessun cancello davanti alla conferma, e in
		// cambio pretende che l'avviso sia impossibile da non vedere proprio
		// lì. Si caricano solo per chi la data la può modificare: a chi guarda
		// la serata di un altro, i conflitti di quello non interessano.
		conflitti: puoModificare ? await conflittiDellEvento(db, viewer, params.id) : []
	};
};

export const actions: Actions = {
	/** Cambio di stato rapido, senza passare dal form lungo. */
	stato: async ({ request, locals, params }) => {
		const viewer = locals.viewer;
		if (!viewer) return fail(401, { errore: 'Sessione non valida.' });

		const db = getDb();
		const evento = await caricaEvento(db, params.id);
		if (!evento || !canEditEvent(viewer, evento)) error(404, 'Data non trovata.');

		const form = await request.formData();
		const richiesto = statoEvento.safeParse(form.get('nuovoStato'));
		if (!richiesto.success) return fail(400, { errore: 'Stato non valido.' });

		const nuovo = richiesto.data;
		if (!puoTransire(evento.status, nuovo)) {
			return fail(400, {
				errore: `Il passaggio ${descriviTransizione(evento.status, nuovo)} non è ammesso. Una data che gli altri hanno già visto non torna in bozza: se non si fa più, annullala.`
			});
		}

		const motivi = motiviCheImpediscono(nuovo, {
			title: evento.title,
			city: evento.city,
			venueId: evento.venueId,
			startsAt: evento.startsAt
		});
		if (motivi.length) return fail(400, { errore: motivi[0].messaggio });

		await cambiaStato(db, viewer.profileId, params.id, evento.status, nuovo);
		return { statoCambiato: descriviTransizione(evento.status, nuovo) };
	},

	elimina: async ({ locals, params }) => {
		const viewer = locals.viewer;
		if (!viewer) return fail(401, { errore: 'Sessione non valida.' });

		const db = getDb();
		const evento = await caricaEvento(db, params.id);
		if (!evento || !canEditEvent(viewer, evento)) error(404, 'Data non trovata.');

		if (!canDeleteEvent(viewer, evento)) {
			return fail(403, {
				errore:
					'Cancellare una data spetta a chi amministra l’organizzazione. Se la serata non si fa, annullala: agli altri serve sapere che lo slot si è liberato.'
			});
		}

		await eliminaEvento(db, viewer.profileId, params.id, evento.title);
		redirect(303, '/calendar');
	}
};
