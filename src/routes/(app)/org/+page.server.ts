/** Profilo dell'organizzazione: dati, membri, inviti. */
import { fail } from '@sveltejs/kit';
import { and, asc, desc, eq } from 'drizzle-orm';
import { canCreateOrgInvite, canInviteToOrg, canManageMembers } from '$lib/server/auth/permissions';
import { getDb } from '$lib/server/db/client';
import { invites, memberships, organizations, profiles } from '$lib/server/db/schema';
import { generateInviteCode } from '$lib/server/invites/code';
import { inviteSchema } from '$lib/schemas/invite';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url }) => {
	const { organizations: orgs, viewer } = await parent();

	const scelta = url.searchParams.get('org');
	const org = orgs.find((o) => o.id === scelta) ?? orgs[0];
	if (!org) return { org: null, membri: [], inviti: [], puoInvitare: false, puoGestire: false };

	const db = getDb();

	const membri = await db
		.select({
			profileId: profiles.id,
			displayName: profiles.displayName,
			email: profiles.email,
			role: memberships.role,
			createdAt: memberships.createdAt
		})
		.from(memberships)
		.innerJoin(profiles, eq(profiles.id, memberships.profileId))
		.where(eq(memberships.organizationId, org.id))
		.orderBy(asc(profiles.displayName));

	const puoInvitare = canInviteToOrg(viewer, org.id);

	const inviti = puoInvitare
		? await db
				.select({
					id: invites.id,
					code: invites.code,
					role: invites.role,
					emailHint: invites.emailHint,
					uses: invites.uses,
					maxUses: invites.maxUses,
					expiresAt: invites.expiresAt,
					createdAt: invites.createdAt
				})
				.from(invites)
				.where(eq(invites.organizationId, org.id))
				.orderBy(desc(invites.createdAt))
				.limit(20)
		: [];

	const dettagli = await db
		.select()
		.from(organizations)
		.where(eq(organizations.id, org.id))
		.limit(1);

	return {
		org: dettagli[0]
			? {
					id: dettagli[0].id,
					name: dettagli[0].name,
					slug: dettagli[0].slug,
					kind: dettagli[0].kind,
					city: dettagli[0].city,
					province: dettagli[0].province,
					defaultConflictRadiusKm: dettagli[0].defaultConflictRadiusKm,
					emailContact: dettagli[0].emailContact,
					website: dettagli[0].website,
					lat: dettagli[0].lat,
					lon: dettagli[0].lon
				}
			: null,
		tutteLeOrg: orgs,
		membri,
		inviti,
		puoInvitare,
		puoGestire: canManageMembers(viewer, org.id),
		puoCreareOrgNuove: canCreateOrgInvite(viewer)
	};
};

export const actions: Actions = {
	/** Genera un invito per la propria organizzazione. */
	creaInvito: async ({ request, locals }) => {
		const viewer = locals.viewer;
		if (!viewer) return fail(401, { error: 'Sessione non valida.' });

		const form = await request.formData();
		const parsed = inviteSchema.safeParse(Object.fromEntries(form));
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Dati non validi.' });
		}

		const { organizationId, role, emailHint, maxUses, expiresInDays } = parsed.data;

		// Un invito senza organizzazione ne crea una nuova: è un potere da
		// platform admin, non da amministratore di circolo.
		if (organizationId === null) {
			if (!canCreateOrgInvite(viewer)) {
				return fail(403, {
					error: 'Solo un amministratore della piattaforma può invitare nuove organizzazioni.'
				});
			}
		} else if (!canInviteToOrg(viewer, organizationId)) {
			return fail(403, { error: 'Non hai i permessi per invitare in questa organizzazione.' });
		}

		const scadenza = new Date();
		scadenza.setUTCDate(scadenza.getUTCDate() + expiresInDays);

		const creato = await getDb()
			.insert(invites)
			.values({
				code: generateInviteCode(),
				organizationId,
				role,
				emailHint,
				maxUses,
				expiresAt: scadenza,
				createdBy: viewer.profileId
			})
			.returning({ code: invites.code });

		return { invitoCreato: creato[0].code };
	},

	/** Revoca un invito azzerandone gli utilizzi disponibili. */
	revocaInvito: async ({ request, locals }) => {
		const viewer = locals.viewer;
		if (!viewer) return fail(401, { error: 'Sessione non valida.' });

		const form = await request.formData();
		const id = String(form.get('inviteId') ?? '');
		const organizationId = String(form.get('organizationId') ?? '');

		if (!canInviteToOrg(viewer, organizationId)) {
			return fail(403, { error: 'Non hai i permessi per revocare questo invito.' });
		}

		// Non cancelliamo la riga: sapere che un invito è esistito ed è stato
		// revocato vale più che non trovarne traccia.
		await getDb()
			.update(invites)
			.set({ maxUses: 0 })
			.where(and(eq(invites.id, id), eq(invites.organizationId, organizationId)));

		return { revocato: true };
	},

	/** Cambia il ruolo di un membro. Solo il titolare. */
	cambiaRuolo: async ({ request, locals }) => {
		const viewer = locals.viewer;
		if (!viewer) return fail(401, { error: 'Sessione non valida.' });

		const form = await request.formData();
		const organizationId = String(form.get('organizationId') ?? '');
		const profileId = String(form.get('profileId') ?? '');
		const role = String(form.get('role') ?? '');

		if (!canManageMembers(viewer, organizationId)) {
			return fail(403, { error: 'Solo il titolare può cambiare i ruoli.' });
		}
		if (!['owner', 'admin', 'moderator', 'member'].includes(role)) {
			return fail(400, { error: 'Ruolo non valido.' });
		}

		const db = getDb();

		// Un'organizzazione senza titolare non può più assegnare ruoli a
		// nessuno: è uno stato da cui non si esce senza intervento manuale.
		if (profileId === viewer.profileId && role !== 'owner') {
			const altriOwner = await db
				.select({ id: memberships.id })
				.from(memberships)
				.where(and(eq(memberships.organizationId, organizationId), eq(memberships.role, 'owner')));
			if (altriOwner.length <= 1) {
				return fail(400, {
					error:
						'Sei l’unico titolare: nomina prima qualcun altro, altrimenti l’organizzazione resta senza.'
				});
			}
		}

		await db
			.update(memberships)
			.set({ role: role as 'owner' | 'admin' | 'moderator' | 'member' })
			.where(
				and(eq(memberships.organizationId, organizationId), eq(memberships.profileId, profileId))
			);

		return { ruoloAggiornato: true };
	}
};
