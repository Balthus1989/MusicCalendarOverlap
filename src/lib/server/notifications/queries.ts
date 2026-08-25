/**
 * Letture della casella delle notifiche.
 *
 * Non c'è nessuna serializzazione da fare qui, e la ragione è la scelta di
 * ADR-0035: il testo è stato redatto quando la notifica è nata, per quel
 * destinatario. Quello che questo file deve garantire è più semplice e non
 * meno importante — **un profilo legge solo le proprie righe**, sempre, con il
 * filtro in `WHERE` e non in un `if` più a valle.
 */
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { leggiContenuto, type ContenutoNotifica } from '$lib/notifications';
import type { Database } from '$lib/server/db/client';
import { notifications, type NotificationKind } from '$lib/server/db/schema';

export type NotificaInPagina = ContenutoNotifica & {
	id: string;
	kind: NotificationKind;
	letta: boolean;
	createdAt: Date;
	/** Vero se una copia fuori dall'applicazione era prevista ed è uscita. */
	consegnata: boolean;
};

export const PER_PAGINA = 50;

export async function elencaNotifiche(
	db: Database,
	profileId: string,
	limite = PER_PAGINA
): Promise<NotificaInPagina[]> {
	const righe = await db
		.select({
			id: notifications.id,
			kind: notifications.kind,
			payload: notifications.payload,
			readAt: notifications.readAt,
			consegnaRichiesta: notifications.consegnaRichiesta,
			consegnataAt: notifications.consegnataAt,
			createdAt: notifications.createdAt
		})
		.from(notifications)
		.where(eq(notifications.profileId, profileId))
		.orderBy(desc(notifications.createdAt))
		.limit(limite);

	return righe.map((r) => ({
		id: r.id,
		kind: r.kind,
		letta: r.readAt !== null,
		createdAt: r.createdAt,
		consegnata: r.consegnaRichiesta && r.consegnataAt !== null,
		...leggiContenuto(r.payload)
	}));
}

/**
 * Segna come lette tutte le notifiche del profilo fino a un certo istante.
 *
 * "Fino a un istante" e non "tutte": fra il caricamento della pagina e il
 * clic può esserne arrivata una nuova, e marcarla letta insieme alle altre la
 * farebbe sparire senza che nessuno l'abbia vista.
 */
export async function segnaLette(
	db: Database,
	profileId: string,
	fino: Date
): Promise<{ segnate: number }> {
	const righe = await db
		.update(notifications)
		.set({ readAt: new Date() })
		.where(
			and(
				eq(notifications.profileId, profileId),
				isNull(notifications.readAt),
				lt(notifications.createdAt, fino)
			)
		)
		.returning({ id: notifications.id });

	return { segnate: righe.length };
}

/** Una sola, per il caso in cui si voglia archiviare la singola riga. */
export async function segnaLetta(db: Database, profileId: string, id: string): Promise<void> {
	await db
		.update(notifications)
		.set({ readAt: new Date() })
		// Il `profile_id` nel `WHERE` non è ridondante: senza, un id indovinato
		// permetterebbe di marcare letta la notifica di un altro.
		.where(and(eq(notifications.id, id), eq(notifications.profileId, profileId)));
}

/** Quante notifiche non lette, per il segnalino in pagina. */
export async function contaNonLette(db: Database, profileId: string): Promise<number> {
	const [riga] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(notifications)
		.where(and(eq(notifications.profileId, profileId), isNull(notifications.readAt)));
	return riga?.n ?? 0;
}
