/**
 * Accettazione di un invito (ADR-0004).
 *
 * Qui `signInWithOtp` viene chiamato con `shouldCreateUser: true`, e solo dopo
 * aver verificato che il codice sia valido. Il login normale non crea utenti.
 *
 * **Non è più l'unica rotta da cui può nascere un account.** Da ADR-0045 un
 * invito con un indirizzo crea l'utente al momento in cui viene generato, per
 * poterglielo spedire. L'invariante che conta è la stessa: un account esiste
 * solo perché qualcuno autorizzato a invitare l'ha voluto, e resta senza
 * profilo e senza membership finché l'invito non viene accettato davvero.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '$lib/server/db/client';
import { clientPerInvio } from '$lib/server/auth/supabase';
import { ensureProfile } from '$lib/server/auth/viewer';
import { lookupInvite, redeemInvite } from '$lib/server/invites/service';
import { profiles } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

const MOTIVI: Record<string, string> = {
	inesistente: 'Questo codice di invito non esiste.',
	scaduto: 'Questo invito è scaduto.',
	esaurito: 'Questo invito è già stato usato il numero massimo di volte.',
	revocato: 'Questo invito è stato revocato.',
	concorrenza: "Qualcun altro ha usato l'ultimo posto disponibile un istante prima di te."
};

export const load: PageServerLoad = async ({ params, locals }) => {
	const db = getDb();
	const trovato = await lookupInvite(db, params.code);

	if (!trovato.ok) {
		return {
			valido: false as const,
			motivo: MOTIVI[trovato.reason] ?? 'Invito non utilizzabile.',
			code: params.code
		};
	}

	const { session, user } = await locals.safeGetSession();
	let displayName = '';
	if (user) {
		const p = await db
			.select({ displayName: profiles.displayName })
			.from(profiles)
			.where(eq(profiles.id, user.id))
			.limit(1);
		displayName = p[0]?.displayName ?? '';
	}

	return {
		valido: true as const,
		code: params.code,
		autenticato: Boolean(session),
		emailHint: trovato.invite.emailHint ?? '',
		ruolo: trovato.invite.role,
		organizzazione: trovato.organization,
		/** Se l'invito non punta a un'organizzazione, l'invitato ne crea una. */
		creaOrganizzazione: trovato.organization === null,
		displayName
	};
};

const richiediLinkSchema = z.object({
	email: z.email('Indirizzo email non valido.')
});

const accettaSchema = z.object({
	displayName: z.string().trim().min(2, 'Serve un nome con cui farti riconoscere.').max(120),
	orgName: z.string().trim().max(120).optional()
});

export const actions: Actions = {
	/** Passo 1, da non autenticato: manda il magic link che crea l'account. */
	richiediLink: async ({ request, params, url }) => {
		const db = getDb();
		const trovato = await lookupInvite(db, params.code);
		if (!trovato.ok) {
			return fail(400, { error: MOTIVI[trovato.reason] ?? 'Invito non utilizzabile.' });
		}

		const form = await request.formData();
		const parsed = richiediLinkSchema.safeParse({ email: form.get('email') });
		if (!parsed.success) {
			return fail(400, {
				email: String(form.get('email') ?? ''),
				error: parsed.error.issues[0]?.message ?? 'Dati non validi.'
			});
		}

		/**
		 * Due cose che qui erano sbagliate tutte e due, e che insieme rendevano
		 * inutilizzabile ogni link mandato da questa pagina.
		 *
		 * **`locals.supabase` era il client sbagliato.** È il client SSR, che
		 * impone PKCE: Supabase emette un token `pkce_…` che `verifyOtp` non sa
		 * risolvere in una chiamata sola, perché pretende il verificatore
		 * custodito nel browser che ha *richiesto* il link. Un link dentro
		 * un'email si apre dal telefono o dalla webmail, e quel presupposto non
		 * regge mai. Vedi `clientPerInvio()`.
		 *
		 * **L'indirizzo di ritorno aveva una query string.** È il guasto di
		 * 7aaad91, riparato allora in `/login` e non qui: `redirect_to` torna
		 * intero, il template email gli appende il proprio `?`, e il link nella
		 * posta finisce con due punti interrogativi. Tutto ciò che segue il
		 * primo diventa query, quindi `token_hash` cade dentro il valore di
		 * `next` e al callback non arriva.
		 *
		 * Il codice dell'invito viaggia perciò nei metadati, come per l'invito
		 * spedito da noi (ADR-0045). `data` vale alla creazione dell'utente, che
		 * è il caso di questa pagina: chi ha già un account entra e basta.
		 */
		const { error: err } = await clientPerInvio().auth.signInWithOtp({
			email: parsed.data.email,
			options: {
				emailRedirectTo: `${url.origin}/auth/callback`,
				data: { codice_invito: params.code },
				// Qui sì: l'invito valido *è* l'autorizzazione a esistere.
				shouldCreateUser: true
			}
		});

		if (err) {
			return fail(400, {
				email: parsed.data.email,
				error: 'Non è stato possibile inviare il link. Riprova fra qualche minuto.'
			});
		}

		return { sent: true, email: parsed.data.email };
	},

	/** Passo 2, da autenticato: consuma l'invito e crea la membership. */
	accetta: async ({ request, params, locals }) => {
		const { user } = await locals.safeGetSession();
		if (!user) error(401, 'Sessione non valida.');

		const db = getDb();
		const form = await request.formData();
		const parsed = accettaSchema.safeParse({
			displayName: form.get('displayName'),
			orgName: form.get('orgName') ?? undefined
		});

		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Dati non validi.' });
		}

		const trovato = await lookupInvite(db, params.code);
		if (!trovato.ok) {
			return fail(400, { error: MOTIVI[trovato.reason] ?? 'Invito non utilizzabile.' });
		}

		if (trovato.organization === null && !parsed.data.orgName) {
			return fail(400, { error: "Serve il nome dell'organizzazione." });
		}

		await ensureProfile(db, user);
		await db
			.update(profiles)
			.set({ displayName: parsed.data.displayName, updatedAt: new Date() })
			.where(eq(profiles.id, user.id));

		const esito = await redeemInvite(
			db,
			params.code,
			user.id,
			parsed.data.orgName ? { name: parsed.data.orgName } : null
		);

		if (!esito.ok) {
			return fail(400, { error: MOTIVI[esito.reason] ?? 'Invito non utilizzabile.' });
		}

		redirect(303, '/onboarding');
	}
};
