/**
 * Registro delle modifiche (ARCHITECTURE.md §4.6).
 *
 * Serve a rispondere a una domanda sola, ma ricorrente: "questa data è
 * cambiata, chi e quando?". Con due organizzazioni che si coordinano al
 * telefono su una serata, non poterlo dire è un problema vero.
 *
 * Non è un meccanismo di sicurezza: nessun permesso si appoggia a queste
 * righe, e un fallimento nello scriverle non deve mai far fallire il
 * salvataggio dell'evento — perdere la traccia è spiacevole, perdere il lavoro
 * dell'utente no.
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PassaggioStato } from '$lib/audit';
import type { Database } from '$lib/server/db/client';
import { auditLog, events, memberships, profiles } from '$lib/server/db/schema';
import { ownsOrganization, type ViewerContext } from '$lib/server/visibility';

export type AzioneAudit = 'create' | 'update' | 'status_change' | 'delete';

/** `{ campo: [prima, dopo] }`, solo per i campi cambiati davvero. */
export type Diff = Record<string, [unknown, unknown]>;

function confrontabile(v: unknown): unknown {
	if (v instanceof Date) return v.toISOString();
	if (v === undefined) return null;
	return v;
}

/**
 * Campi cambiati fra due versioni. Confronta solo le chiavi presenti in
 * `dopo`: un `update` parziale non deve risultare come cancellazione di tutto
 * il resto.
 */
export function calcolaDiff(
	prima: Record<string, unknown>,
	dopo: Record<string, unknown>
): Diff | null {
	const diff: Diff = {};
	for (const [campo, valoreDopo] of Object.entries(dopo)) {
		const a = confrontabile(prima[campo]);
		const b = confrontabile(valoreDopo);
		// Il confronto è per valore serializzato: array e oggetti (lineup,
		// generi) cambiano di identità a ogni lettura dal database.
		if (JSON.stringify(a) !== JSON.stringify(b)) diff[campo] = [a, b];
	}
	return Object.keys(diff).length ? diff : null;
}

export async function registraAudit(
	db: Database,
	voce: {
		actorProfileId: string | null;
		entityType: 'event' | 'conflict' | 'membership';
		entityId: string;
		action: AzioneAudit;
		diff?: Diff | null;
	}
): Promise<void> {
	try {
		await db.insert(auditLog).values({
			actorProfileId: voce.actorProfileId,
			entityType: voce.entityType,
			entityId: voce.entityId,
			action: voce.action,
			diff: voce.diff ?? null
		});
	} catch (err) {
		// Volutamente non rilanciato: vedi l'intestazione del file.
		console.error('Registro di audit non scritto:', err);
	}
}

/* ------------------------------------------------------------------ *
 * Lettura (Fase 6)
 * ------------------------------------------------------------------ */

/**
 * Chi può leggere il registro di una data: **solo la sua organizzazione.**
 *
 * Non è una scelta prudenziale, è la matrice di §5 applicata alla storia. Il
 * registro contiene i valori *precedenti* dei campi, e fra quelli c'è il
 * titolo: farlo vedere a un'altra organizzazione significherebbe raccontarle
 * il titolo che una data aveva quando era ancora opzionata. Il platform admin
 * non fa eccezione, per la stessa ragione di ADR-0019.
 */
export function puoLeggereAudit(viewer: ViewerContext, organizationId: string): boolean {
	return ownsOrganization(viewer, organizationId);
}

export type VoceRegistro = {
	id: string;
	entityType: string;
	entityId: string;
	action: string;
	attore: string | null;
	diff: Diff | null;
	createdAt: Date;
	/** Come si chiama la cosa cambiata: il titolo della data, il nome del membro. */
	oggetto: string;
};

/** Le colonne dell'audit più il nome di chi ha agito, per ogni query di questo file. */
const COLONNE = {
	id: auditLog.id,
	entityType: auditLog.entityType,
	entityId: auditLog.entityId,
	action: auditLog.action,
	attore: profiles.displayName,
	diff: auditLog.diff,
	createdAt: auditLog.createdAt
} as const;

type RigaGrezza = {
	id: string;
	entityType: string;
	entityId: string;
	action: string;
	attore: string | null;
	diff: unknown;
	createdAt: Date;
};

const aVoce = (r: RigaGrezza, oggetto: string): VoceRegistro => ({
	id: r.id,
	entityType: r.entityType,
	entityId: r.entityId,
	action: r.action,
	attore: r.attore,
	diff: (r.diff ?? null) as Diff | null,
	createdAt: r.createdAt,
	oggetto
});

/**
 * La storia di una singola data.
 *
 * Il filtro di appartenenza è nel `WHERE`, non in un controllo a valle: la
 * `join` con `events` è anche ciò che restringe all'organizzazione giusta, e
 * senza organizzazioni la query non parte affatto.
 */
export async function registroDellEvento(
	db: Database,
	viewer: ViewerContext,
	eventId: string,
	limite = 50
): Promise<VoceRegistro[]> {
	if (!viewer.organizationIds.length) return [];

	const righe = await db
		.select({ ...COLONNE, titolo: events.title })
		.from(auditLog)
		.innerJoin(events, eq(events.id, auditLog.entityId))
		.leftJoin(profiles, eq(profiles.id, auditLog.actorProfileId))
		.where(
			and(
				eq(auditLog.entityType, 'event'),
				eq(auditLog.entityId, eventId),
				inArray(events.organizationId, viewer.organizationIds)
			)
		)
		.orderBy(desc(auditLog.createdAt))
		.limit(limite);

	return righe.map((r) => aVoce(r, r.titolo));
}

/**
 * Il registro delle organizzazioni del viewer: date e membri.
 *
 * I conflitti restano fuori di proposito, pur essendo registrati: la loro
 * storia si legge già in dashboard, dove c'è anche la nota con cui sono stati
 * chiusi, e ripeterla qui vorrebbe dire raccontare due volte la stessa cosa in
 * due posti che possono divergere.
 */
export async function registroDelleOrganizzazioni(
	db: Database,
	viewer: ViewerContext,
	limite = 100
): Promise<VoceRegistro[]> {
	if (!viewer.organizationIds.length) return [];

	const suEventi = await db
		.select({ ...COLONNE, oggetto: events.title })
		.from(auditLog)
		.innerJoin(events, eq(events.id, auditLog.entityId))
		.leftJoin(profiles, eq(profiles.id, auditLog.actorProfileId))
		.where(
			and(eq(auditLog.entityType, 'event'), inArray(events.organizationId, viewer.organizationIds))
		)
		.orderBy(desc(auditLog.createdAt))
		.limit(limite);

	// Le due query non si possono unire: una passa da `events`, l'altra da
	// `memberships`, e l'`entity_id` dell'audit punta a tabelle diverse a
	// seconda di `entity_type`. Un `UNION` con due join diversi sarebbe una
	// riga di SQL più corta e molto meno leggibile.
	const membro = alias(profiles, 'membro');
	const suMembri = await db
		.select({ ...COLONNE, oggetto: membro.displayName })
		.from(auditLog)
		.innerJoin(memberships, eq(memberships.id, auditLog.entityId))
		.innerJoin(membro, eq(membro.id, memberships.profileId))
		.leftJoin(profiles, eq(profiles.id, auditLog.actorProfileId))
		.where(
			and(
				eq(auditLog.entityType, 'membership'),
				inArray(memberships.organizationId, viewer.organizationIds)
			)
		)
		.orderBy(desc(auditLog.createdAt))
		.limit(limite);

	return [...suEventi, ...suMembri]
		.map((r) => aVoce(r, r.oggetto ?? 'senza nome'))
		.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
		.slice(0, limite);
}

/**
 * I passaggi di stato delle proprie date, per la metrica di §1.
 *
 * Si leggono dal registro e non da `events.status`, che dice solo dove una
 * data è arrivata: la domanda è **come** ci è arrivata, e quella informazione
 * esiste solo qui.
 */
export async function passaggiDiStato(
	db: Database,
	viewer: ViewerContext,
	limite = 2000
): Promise<PassaggioStato[]> {
	if (!viewer.organizationIds.length) return [];

	const righe = await db
		.select({ entityId: auditLog.entityId, diff: auditLog.diff })
		.from(auditLog)
		.innerJoin(events, eq(events.id, auditLog.entityId))
		.where(
			and(
				eq(auditLog.entityType, 'event'),
				inArray(auditLog.action, ['create', 'status_change']),
				inArray(events.organizationId, viewer.organizationIds)
			)
		)
		// Crescente: `metricaHold` conta ogni data alla **prima** conferma, e
		// per farlo deve vedere i passaggi nell'ordine in cui sono avvenuti.
		.orderBy(asc(auditLog.createdAt))
		.limit(limite);

	const passaggi: PassaggioStato[] = [];
	for (const r of righe) {
		const diff = (r.diff ?? null) as Diff | null;
		const cambio = diff?.status;
		if (!cambio) continue;
		const [da, a] = cambio;
		if (typeof a !== 'string') continue;
		passaggi.push({ entityId: r.entityId, da: typeof da === 'string' ? da : null, a });
	}
	return passaggi;
}
