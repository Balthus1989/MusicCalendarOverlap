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
import type { Database } from '$lib/server/db/client';
import { auditLog } from '$lib/server/db/schema';

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
