/**
 * Accettazione di un invito (ADR-0004).
 *
 * È l'**unica** rotta da cui può nascere un account: solo qui
 * `signInWithOtp` viene chiamato con `shouldCreateUser: true`, e solo dopo
 * aver verificato che il codice sia valido. Il login normale non crea utenti.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '$lib/server/db/client';
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
	richiediLink: async ({ request, params, url, locals }) => {
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

		const next = `/invite/${encodeURIComponent(params.code)}`;
		const { error: err } = await locals.supabase.auth.signInWithOtp({
			email: parsed.data.email,
			options: {
				emailRedirectTo: `${url.origin}/auth/callback?next=${encodeURIComponent(next)}`,
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
