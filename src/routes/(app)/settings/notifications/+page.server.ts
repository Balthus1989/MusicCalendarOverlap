/**
 * Quali email ricevere (ARCHITECTURE.md §7, §10).
 *
 * Tre interruttori e non uno per riga di §10, perché la granularità utile è
 * quella di cui qualcuno si lamenterebbe: il digest settimanale, i solleciti
 * sulle proprie opzioni, gli avvisi di conflitto. Un interruttore per ciascun
 * genere di conflitto sarebbe una schermata di preferenze più lunga della
 * dashboard che governa.
 *
 * Le notifiche in-app non hanno interruttore: non arrivano addosso a nessuno,
 * si leggono quando si apre la pagina. Spegnerle vorrebbe dire spegnere anche
 * la coda di uscita delle email (ADR-0036), che è la stessa tabella.
 */
import { error, fail } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/client';
import { preferenzeDelProfilo, salvaPreferenze } from '$lib/server/notifications/service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const profile = locals.profile;
	if (!profile) error(401, 'Sessione non valida.');

	return {
		preferenze: await preferenzeDelProfilo(getDb(), profile.id),
		email: profile.email
	};
};

export const actions: Actions = {
	salva: async ({ request, locals }) => {
		const profile = locals.profile;
		if (!profile) return fail(401, { errore: 'Sessione non valida.', salvato: false });

		const form = await request.formData();
		// Una checkbox non spuntata non arriva affatto nel `FormData`: la
		// presenza del campo *è* il valore, e leggerlo così evita di dover
		// aggiungere un campo nascosto per ogni interruttore.
		const acceso = (nome: string) => form.get(nome) !== null;

		await salvaPreferenze(getDb(), profile.id, {
			emailConflitti: acceso('emailConflitti'),
			emailDigest: acceso('emailDigest'),
			emailSolleciti: acceso('emailSolleciti')
		});

		return { salvato: true, errore: null };
	}
};
