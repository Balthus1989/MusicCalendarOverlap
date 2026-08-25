/**
 * Quali avvisi ricevere fuori dall'applicazione (ARCHITECTURE.md §7, §10).
 *
 * Tre interruttori e non uno per riga di §10, perché la granularità utile è
 * quella di cui qualcuno si lamenterebbe: il riepilogo settimanale, i
 * solleciti sulle proprie opzioni, gli avvisi di conflitto. Un interruttore
 * per ciascun genere di conflitto sarebbe una schermata di preferenze più
 * lunga della dashboard che governa.
 *
 * **I nomi non citano il canale.** Governano la consegna, qualunque essa sia:
 * fino alla Fase 6 era l'email, adesso è Telegram (ADR-0039). Se domani fosse
 * altro, questa pagina non se ne accorgerebbe.
 *
 * Le notifiche in pagina non hanno interruttore: non arrivano addosso a
 * nessuno, si leggono quando si apre la casella. Spegnerle vorrebbe dire
 * spegnere anche la coda di uscita (ADR-0036), che è la stessa tabella.
 */
import { error, fail } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/client';
import { preferenzeDelProfilo, salvaPreferenze } from '$lib/server/notifications/service';
import { sinkAttivi } from '$lib/server/notifications/sinks';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const profile = locals.profile;
	if (!profile) error(401, 'Sessione non valida.');

	return {
		preferenze: await preferenzeDelProfilo(getDb(), profile.id),
		/**
		 * Se un canale esiste davvero su questa macchina.
		 *
		 * Senza, questi interruttori governano qualcosa che non parte, e
		 * lasciarlo intendere sarebbe la stessa bugia che si è appena tolta
		 * dal prodotto smettendo di promettere email.
		 */
		canaliAttivi: sinkAttivi().map((s) => s.nome)
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
			avvisaConflitti: acceso('avvisaConflitti'),
			avvisaDigest: acceso('avvisaDigest'),
			avvisaSolleciti: acceso('avvisaSolleciti')
		});

		return { salvato: true, errore: null };
	}
};
