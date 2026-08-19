/**
 * Riscatto di un invito. È l'unico modo per entrare nel calendario (ADR-0004),
 * quindi la logica sta in un punto solo e non nelle rotte.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '$lib/server/db/client';
import { invites, memberships, organizations, type Invite } from '$lib/server/db/schema';
import { slugify } from '$lib/server/text';
import { inviteState, normalizeInviteCode } from './code';

export type InviteLookup =
	| { ok: true; invite: Invite; organization: { id: string; name: string } | null }
	| { ok: false; reason: 'inesistente' | 'scaduto' | 'esaurito' | 'revocato' };

export async function lookupInvite(
	db: Database,
	rawCode: string,
	now: Date = new Date()
): Promise<InviteLookup> {
	const code = normalizeInviteCode(rawCode);
	if (!code) return { ok: false, reason: 'inesistente' };

	const righe = await db
		.select({ invite: invites, org: organizations })
		.from(invites)
		.leftJoin(organizations, eq(invites.organizationId, organizations.id))
		.where(eq(invites.code, code))
		.limit(1);

	const riga = righe[0];
	if (!riga) return { ok: false, reason: 'inesistente' };

	const stato = inviteState(riga.invite, now);
	if (!stato.usable) return { ok: false, reason: stato.reason };

	return {
		ok: true,
		invite: riga.invite,
		organization: riga.org ? { id: riga.org.id, name: riga.org.name } : null
	};
}

/** Slug libero derivato dal nome; aggiunge un suffisso se già preso. */
export async function uniqueOrgSlug(db: Database, name: string): Promise<string> {
	const base = slugify(name) || 'organizzazione';
	for (let i = 0; i < 50; i++) {
		const candidato = i === 0 ? base : `${base}-${i + 1}`;
		const preso = await db
			.select({ id: organizations.id })
			.from(organizations)
			.where(eq(organizations.slug, candidato))
			.limit(1);
		if (!preso[0]) return candidato;
	}
	// Cinquanta omonimi sono improbabili; se succede, meglio uno slug brutto
	// che un fallimento.
	return `${base}-${Date.now().toString(36)}`;
}

export type RedeemResult =
	| { ok: true; organizationId: string; giaMembro: boolean }
	| { ok: false; reason: 'inesistente' | 'scaduto' | 'esaurito' | 'revocato' | 'concorrenza' };

/**
 * Consuma un invito e crea la membership.
 *
 * L'incremento di `uses` è condizionato in SQL (`uses < max_uses`): due
 * riscatti simultanei dell'ultimo utilizzo disponibile non possono passare
 * entrambi, cosa che un controllo letto-poi-scritto in JavaScript non
 * garantirebbe.
 */
export async function redeemInvite(
	db: Database,
	rawCode: string,
	profileId: string,
	nuovaOrganizzazione: { name: string } | null,
	now: Date = new Date()
): Promise<RedeemResult> {
	const trovato = await lookupInvite(db, rawCode, now);
	if (!trovato.ok) return { ok: false, reason: trovato.reason };

	const { invite } = trovato;

	// Se il profilo è già dentro quell'organizzazione, non consumiamo un uso.
	if (invite.organizationId) {
		const gia = await db
			.select({ id: memberships.id })
			.from(memberships)
			.where(
				and(
					eq(memberships.profileId, profileId),
					eq(memberships.organizationId, invite.organizationId)
				)
			)
			.limit(1);
		if (gia[0]) return { ok: true, organizationId: invite.organizationId, giaMembro: true };
	}

	const consumato = await db
		.update(invites)
		.set({ uses: sql`${invites.uses} + 1` })
		.where(and(eq(invites.id, invite.id), sql`${invites.uses} < ${invites.maxUses}`))
		.returning({ id: invites.id });

	if (!consumato[0]) return { ok: false, reason: 'concorrenza' };

	let organizationId = invite.organizationId;

	if (!organizationId) {
		const nome = nuovaOrganizzazione?.name?.trim();
		if (!nome) {
			// Rimettiamo a posto l'uso consumato: l'invito non è stato speso.
			await db
				.update(invites)
				.set({ uses: sql`greatest(${invites.uses} - 1, 0)` })
				.where(eq(invites.id, invite.id));
			return { ok: false, reason: 'inesistente' };
		}

		const creata = await db
			.insert(organizations)
			.values({ name: nome, slug: await uniqueOrgSlug(db, nome) })
			.returning({ id: organizations.id });
		organizationId = creata[0].id;
	}

	await db
		.insert(memberships)
		.values({
			profileId,
			organizationId,
			// Chi crea l'organizzazione ne è il titolare, qualunque cosa dica
			// l'invito: un'organizzazione senza owner non può assegnare ruoli.
			role: invite.organizationId ? invite.role : 'owner'
		})
		.onConflictDoNothing();

	return { ok: true, organizationId, giaMembro: false };
}
