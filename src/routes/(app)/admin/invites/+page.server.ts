/**
 * Inviti che creano organizzazioni nuove — solo platform admin (ADR-0004).
 *
 * È anche il punto di innesco del sistema: al primo avvio non esiste nessuna
 * organizzazione, e questa è l'unica pagina raggiungibile da un profilo che non
 * appartiene a nessuna.
 */
import { error, fail } from '@sveltejs/kit';
import { desc, eq, isNull } from 'drizzle-orm';
import { canCreateOrgInvite } from '$lib/server/auth/permissions';
import { getDb } from '$lib/server/db/client';
import { invites, organizations, profiles } from '$lib/server/db/schema';
import { generateInviteCode } from '$lib/server/invites/code';
import { inviteSchema } from '$lib/schemas/invite';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { viewer } = await parent();
	if (!canCreateOrgInvite(viewer)) {
		error(403, 'Questa pagina è riservata agli amministratori della piattaforma.');
	}

	const db = getDb();

	const apertiSenzaOrg = await db
		.select({
			id: invites.id,
			code: invites.code,
			role: invites.role,
			emailHint: invites.emailHint,
			uses: invites.uses,
			maxUses: invites.maxUses,
			expiresAt: invites.expiresAt,
			autore: profiles.displayName
		})
		.from(invites)
		.leftJoin(profiles, eq(profiles.id, invites.createdBy))
		.where(isNull(invites.organizationId))
		.orderBy(desc(invites.createdAt))
		.limit(30);

	// Le organizzazioni esterne restano fuori: sono schede nate da una
	// segnalazione, non posti in cui si entra (ADR-0044). Farle comparire qui
	// significherebbe poter invitare qualcuno dentro una scheda, e ottenere
	// un'organizzazione con membri che il motore continua a trattare come di
	// nessuno. Il passaggio a organizzazione vera esiste — la riga c'è già e
	// nessuna foreign key si sposta — ma è un'operazione deliberata, non un
	// invito distratto: aggiunge la membership **e** spegne `esterna`.
	const tutteLeOrg = await db
		.select({ id: organizations.id, name: organizations.name, city: organizations.city })
		.from(organizations)
		.where(eq(organizations.esterna, false))
		.orderBy(organizations.name);

	return { inviti: apertiSenzaOrg, tutteLeOrg };
};

export const actions: Actions = {
	crea: async ({ request, locals }) => {
		const viewer = locals.viewer;
		if (!viewer) return fail(401, { error: 'Sessione non valida.', invitoCreato: null });
		if (!canCreateOrgInvite(viewer)) {
			return fail(403, {
				error: 'Solo un amministratore della piattaforma può creare organizzazioni.',
				invitoCreato: null
			});
		}

		const form = await request.formData();
		const parsed = inviteSchema.safeParse({
			...Object.fromEntries(form),
			// Questo tipo di invito non punta a nessuna organizzazione: è
			// l'invitato a crearne una accettandolo.
			organizationId: ''
		});

		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? 'Dati non validi.',
				invitoCreato: null
			});
		}

		const { emailHint, maxUses, expiresInDays } = parsed.data;
		const scadenza = new Date();
		scadenza.setUTCDate(scadenza.getUTCDate() + expiresInDays);

		const creato = await getDb()
			.insert(invites)
			.values({
				code: generateInviteCode(),
				organizationId: null,
				// Chi crea l'organizzazione ne diventa titolare, a prescindere:
				// vedi `redeemInvite`.
				role: 'owner',
				emailHint,
				maxUses,
				expiresAt: scadenza,
				createdBy: viewer.profileId
			})
			.returning({ code: invites.code });

		return { invitoCreato: creato[0].code, error: null };
	},

	revoca: async ({ request, locals }) => {
		const viewer = locals.viewer;
		if (!viewer) return fail(401, { error: 'Sessione non valida.', invitoCreato: null });
		if (!canCreateOrgInvite(viewer)) {
			return fail(403, { error: 'Non hai i permessi.', invitoCreato: null });
		}

		const form = await request.formData();
		await getDb()
			.update(invites)
			.set({ maxUses: 0 })
			.where(eq(invites.id, String(form.get('inviteId') ?? '')));

		return { invitoCreato: null, error: null };
	}
};
