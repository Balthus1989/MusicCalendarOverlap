/**
 * Le tre cose che una persona può fare a un conflitto.
 *
 * Prendere atto, archiviarlo, risolverlo con una nota. Nessuna delle tre
 * cambia una data: il conflitto è la traccia di una conversazione fra due
 * organizzatori, e queste azioni servono a registrare che la conversazione
 * c'è stata (ADR-0009). Non esiste un'azione che *impedisca* qualcosa: quello
 * lo dice ADR-0022.
 *
 * Chi può farle: chiunque sia membro di una delle due organizzazioni. Non
 * serve un ruolo — chi carica le date, in un circolo, spesso non è chi lo
 * governa — e non basta essere platform admin, che sugli eventi altrui è un
 * estraneo (ADR-0019).
 */
import { eq } from 'drizzle-orm';
import { registraAudit } from '$lib/server/audit';
import type { Database } from '$lib/server/db/client';
import { conflicts } from '$lib/server/db/schema';
import { avvisiConflittoRisolto } from '$lib/server/notifications/conflitti';
import { notifica } from '$lib/server/notifications/service';
import type { ViewerContext } from '$lib/server/visibility';

/** Il lato della coppia ordinata su cui sta il viewer. */
export type Lato = 'a' | 'b';

export type ConflittoDelViewer = {
	id: string;
	lato: Lato;
	statoAttuale: (typeof conflicts.$inferSelect)['status'];
};

/**
 * Trova il conflitto e da che parte lo guarda il viewer.
 *
 * Restituisce `null` se il conflitto non esiste o se il viewer non appartiene
 * a nessuna delle due organizzazioni: le rotte trattano quel `null` come un
 * 404, non come un 403. Dire "esiste ma non è tuo" di un conflitto è già dire
 * che due date che non ti riguardano si stanno pestando i piedi.
 */
export async function trovaPerIlViewer(
	db: Database,
	viewer: ViewerContext,
	conflictId: string
): Promise<ConflittoDelViewer | null> {
	if (!viewer.organizationIds.length) return null;

	const riga = await db.query.conflicts.findFirst({
		where: eq(conflicts.id, conflictId),
		with: {
			eventA: { columns: { organizationId: true } },
			eventB: { columns: { organizationId: true } }
		}
	});
	if (!riga) return null;

	const suA = viewer.organizationIds.includes(riga.eventA.organizationId);
	const suB = viewer.organizationIds.includes(riga.eventB.organizationId);
	if (!suA && !suB) return null;

	return { id: riga.id, lato: suA ? 'a' : 'b', statoAttuale: riga.status };
}

/**
 * "L'abbiamo visto."
 *
 * Segna solo il proprio lato: che l'altra organizzazione ne abbia preso atto
 * è un'informazione diversa, e vederla è metà del valore della dashboard —
 * dice se la telefonata è partita o se si è ancora in due a guardarsi.
 *
 * Il conflitto passa a `acknowledged` appena uno dei due lati lo segna: da
 * quel momento non è più una notizia da rilanciare al ricalcolo.
 */
export async function prendiAtto(
	db: Database,
	viewer: ViewerContext,
	conflitto: ConflittoDelViewer
): Promise<void> {
	await db
		.update(conflicts)
		.set({
			...(conflitto.lato === 'a' ? { acknowledgedByA: true } : { acknowledgedByB: true }),
			// Un conflitto già risolto o archiviato non torna indietro: se
			// qualcuno prende atto di una cosa chiusa, resta chiusa.
			...(conflitto.statoAttuale === 'open' ? { status: 'acknowledged' as const } : {}),
			updatedAt: new Date()
		})
		.where(eq(conflicts.id, conflitto.id));

	await registraAudit(db, {
		actorProfileId: viewer.profileId,
		entityType: 'conflict',
		entityId: conflitto.id,
		action: 'update',
		diff: { [`acknowledged_by_${conflitto.lato}`]: [false, true] }
	});
}

/**
 * "Ne abbiamo parlato, ecco com'è andata."
 *
 * La nota è obbligatoria: un conflitto chiuso senza spiegazione, riletto fra
 * sei mesi, è indistinguibile da uno chiuso per stanchezza. `resolvedBy`
 * valorizzato è anche ciò che impedisce al ricalcolo di riaprirlo: una
 * decisione presa da una persona vale più di quella del motore.
 */
export async function risolviConNota(
	db: Database,
	viewer: ViewerContext,
	conflitto: ConflittoDelViewer,
	nota: string
): Promise<void> {
	await db
		.update(conflicts)
		.set({
			status: 'resolved',
			resolutionNote: nota,
			resolvedBy: viewer.profileId,
			...(conflitto.lato === 'a' ? { acknowledgedByA: true } : { acknowledgedByB: true }),
			updatedAt: new Date()
		})
		.where(eq(conflicts.id, conflitto.id));

	await registraAudit(db, {
		actorProfileId: viewer.profileId,
		entityType: 'conflict',
		entityId: conflitto.id,
		action: 'status_change',
		diff: { status: [conflitto.statoAttuale, 'resolved'], resolution_note: [null, nota] }
	});

	// Solo in-app, per tutti e due i lati (§10, riga 2): la chiusura la scrive
	// uno solo dei due, e l'altro deve poterlo sapere senza tornare in
	// dashboard a controllare. `notifica` non solleva mai.
	await notifica(db, await avvisiConflittoRisolto(db, conflitto.id));
}

/**
 * "Lo sappiamo e va bene così."
 *
 * Diverso da `resolved`: il conflitto c'è ancora e ci resterà, semplicemente
 * i due hanno deciso che le due serate possono coesistere. Due date dello
 * stesso genere a quaranta chilometri con pubblici diversi sono il caso
 * tipico, e chi lo sa sono loro (ADR-0022).
 */
export async function archivia(
	db: Database,
	viewer: ViewerContext,
	conflitto: ConflittoDelViewer,
	nota: string | null
): Promise<void> {
	await db
		.update(conflicts)
		.set({
			status: 'dismissed',
			resolutionNote: nota,
			resolvedBy: viewer.profileId,
			...(conflitto.lato === 'a' ? { acknowledgedByA: true } : { acknowledgedByB: true }),
			updatedAt: new Date()
		})
		.where(eq(conflicts.id, conflitto.id));

	await registraAudit(db, {
		actorProfileId: viewer.profileId,
		entityType: 'conflict',
		entityId: conflitto.id,
		action: 'status_change',
		diff: { status: [conflitto.statoAttuale, 'dismissed'] }
	});
}

/**
 * Riapre un conflitto chiuso. Serve quando ci si accorge di aver archiviato
 * troppo in fretta: la storia non si cancella, si aggiunge.
 */
export async function riapri(
	db: Database,
	viewer: ViewerContext,
	conflitto: ConflittoDelViewer
): Promise<void> {
	await db
		.update(conflicts)
		.set({
			status: 'open',
			resolutionNote: null,
			resolvedBy: null,
			acknowledgedByA: false,
			acknowledgedByB: false,
			updatedAt: new Date()
		})
		.where(eq(conflicts.id, conflitto.id));

	await registraAudit(db, {
		actorProfileId: viewer.profileId,
		entityType: 'conflict',
		entityId: conflitto.id,
		action: 'status_change',
		diff: { status: [conflitto.statoAttuale, 'open'] }
	});
}
