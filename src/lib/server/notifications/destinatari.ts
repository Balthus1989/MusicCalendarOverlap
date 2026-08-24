/**
 * Chi riceve un avviso.
 *
 * Una regola sola, e vale per tutti e cinque i motivi di §10: **si avvisa
 * un'organizzazione, non una persona.** Un conflitto riguarda la data, e la
 * data è del circolo; mandarlo solo a chi l'ha inserita significherebbe che
 * un avviso grave si perde perché quella sera quella persona era in tour.
 *
 * L'unica eccezione è l'invito, che arriva a un indirizzo email di qualcuno
 * che nel calendario non esiste ancora: non ha un profilo, e infatti non passa
 * da qui (vedi `messages.ts`).
 */
import { eq, inArray } from 'drizzle-orm';
import type { Database } from '$lib/server/db/client';
import { memberships, profiles } from '$lib/server/db/schema';
import type { Destinatario } from './types';

/**
 * I membri delle organizzazioni indicate, raggruppati per organizzazione.
 *
 * Una persona in due circoli compare in entrambi gli elenchi: è corretto, e la
 * chiave di deduplica in `notifications` fa il resto — riceve l'avviso una
 * volta sola, nella forma redatta per il primo dei due lati.
 */
export async function membriPerOrganizzazione(
	db: Database,
	organizationIds: string[]
): Promise<Map<string, Destinatario[]>> {
	const mappa = new Map<string, Destinatario[]>();
	if (!organizationIds.length) return mappa;

	const righe = await db
		.select({
			organizationId: memberships.organizationId,
			profileId: profiles.id,
			displayName: profiles.displayName,
			email: profiles.email
		})
		.from(memberships)
		.innerJoin(profiles, eq(profiles.id, memberships.profileId))
		.where(inArray(memberships.organizationId, organizationIds));

	for (const r of righe) {
		const elenco = mappa.get(r.organizationId) ?? [];
		elenco.push({ profileId: r.profileId, displayName: r.displayName, email: r.email });
		mappa.set(r.organizationId, elenco);
	}

	for (const id of organizationIds) if (!mappa.has(id)) mappa.set(id, []);
	return mappa;
}

/** Tutti gli iscritti che appartengono ad almeno un'organizzazione: il digest va a loro. */
export async function tuttiGliIscritti(db: Database): Promise<Destinatario[]> {
	const righe = await db
		.selectDistinct({
			profileId: profiles.id,
			displayName: profiles.displayName,
			email: profiles.email
		})
		.from(memberships)
		.innerJoin(profiles, eq(profiles.id, memberships.profileId));

	return righe;
}

/** Le organizzazioni di un profilo, per costruirgli il contesto di visibilità. */
export async function organizzazioniDi(db: Database, profileId: string): Promise<string[]> {
	const righe = await db
		.select({ organizationId: memberships.organizationId })
		.from(memberships)
		.where(eq(memberships.profileId, profileId));
	return righe.map((r) => r.organizationId);
}
