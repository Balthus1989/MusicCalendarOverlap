/**
 * Autenticazione dei job periodici (ARCHITECTURE.md §10, ADR-0013).
 *
 * Non c'è nessuno scheduler acceso: i job sono GitHub Actions che chiamano un
 * endpoint con un segreto condiviso nell'header. Un manutentore part-time e
 * qualche decina di operazioni al giorno non giustificano una coda.
 *
 * Il segreto sta in `CRON_SECRET` e non ha prefisso `PUBLIC_`: quel prefisso,
 * in SvelteKit, significa "esposto al browser".
 */
import { env } from '$env/dynamic/private';

export const HEADER_CRON = 'x-cron-secret';

/**
 * Confronto a tempo costante.
 *
 * `===` su stringhe esce al primo carattere diverso, e la differenza di tempo
 * è misurabile su una rete abbastanza silenziosa: si perde poco a scriverlo
 * bene e su un endpoint che ricalcola l'intero calendario non è il posto dove
 * risparmiare.
 */
function ugualiATempoCostante(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

export type EsitoAutorizzazione = { ok: true } | { ok: false; motivo: string };

/** Verifica l'header segreto di una richiesta di cron. */
export function autorizzaCron(request: Request): EsitoAutorizzazione {
	const atteso = env.CRON_SECRET?.trim();
	// Senza segreto configurato l'endpoint resta chiuso. L'alternativa —
	// lasciarlo aperto quando la variabile manca — trasformerebbe una
	// dimenticanza di configurazione in un endpoint pubblico che riscrive
	// mezzo database.
	if (!atteso) return { ok: false, motivo: 'CRON_SECRET non configurata sul server.' };

	const fornito = request.headers.get(HEADER_CRON)?.trim();
	if (!fornito || !ugualiATempoCostante(fornito, atteso)) {
		return { ok: false, motivo: 'Segreto mancante o non valido.' };
	}

	return { ok: true };
}
