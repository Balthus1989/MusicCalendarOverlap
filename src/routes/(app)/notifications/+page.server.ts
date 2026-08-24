/**
 * La casella degli avvisi (ARCHITECTURE.md §10).
 *
 * Non compare in §7 fra le rotte previste, e la ragione è che la specifica
 * dava per scontata la tabella `notifications` con il suo `read_at` senza
 * dire dove si leggessero. Qui.
 *
 * Non c'è nessun filtro di visibilità da applicare in questa pagina, e non è
 * una svista: le righe sono già redatte alla nascita (ADR-0035) e la query
 * restringe al proprio `profile_id`. È l'unico posto dell'applicazione dove
 * quella frase è vera, ed è il motivo per cui è scritta qui in cima.
 */
import { error, fail } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/client';
import { elencaNotifiche, segnaLette } from '$lib/server/notifications/queries';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const profile = locals.profile;
	if (!profile) error(401, 'Sessione non valida.');

	const notifiche = await elencaNotifiche(getDb(), profile.id);

	return {
		notifiche,
		nonLette: notifiche.filter((n) => !n.letta).length,
		/**
		 * L'istante del caricamento, che torna al server con il pulsante
		 * "segna tutte lette". Una notifica arrivata nel frattempo non deve
		 * sparire senza essere stata vista.
		 */
		caricataAlle: new Date().toISOString()
	};
};

export const actions: Actions = {
	segnaLette: async ({ request, locals }) => {
		const profile = locals.profile;
		if (!profile) return fail(401, { errore: 'Sessione non valida.' });

		const form = await request.formData();
		const grezzo = String(form.get('fino') ?? '');
		const fino = new Date(grezzo);
		if (Number.isNaN(fino.getTime())) return fail(400, { errore: 'Istante non valido.' });

		return { ...(await segnaLette(getDb(), profile.id, fino)), errore: null };
	}
};
