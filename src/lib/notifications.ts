/**
 * Testi delle notifiche condivisi fra server e browser.
 *
 * Sta fuori da `$lib/server` per la stessa ragione di `$lib/conflicts.ts`: la
 * pagina degli avvisi li mostra nel bundle del client. Vale la stessa regola —
 * qui ci vanno solo etichette da mostrare, mai decisioni su chi vede cosa.
 * Quelle stanno nel layer di notifica sul server, che scrive già redatto
 * (ADR-0035).
 */
import type { NotificationKind } from '$lib/server/db/schema';

export const ETICHETTE_NOTIFICA: Record<NotificationKind, string> = {
	conflitto_nuovo: 'Conflitto',
	conflitto_risolto: 'Conflitto risolto',
	invito: 'Invito',
	digest_settimanale: 'Riepilogo',
	sollecito_annuncio: 'Promemoria'
};

/**
 * Il contenuto di una notifica, così com'è stato scritto al momento in cui è
 * nata: titolo, corpo e dove andare a vedere.
 *
 * È congelato di proposito. Ricalcolarlo alla lettura vorrebbe dire rifare la
 * redazione una seconda volta, in un punto dove il contesto di chi guarda
 * potrebbe nel frattempo essere cambiato — una membership aggiunta o tolta —
 * e produrre un avviso diverso da quello che era già stato consegnato.
 */
export type ContenutoNotifica = {
	titolo: string;
	testo: string;
	/** Percorso interno all'applicazione, senza dominio. `null` se non c'è dove andare. */
	url: string | null;
};

/** Legge il payload `jsonb` senza fidarsene: è pur sempre una colonna libera. */
export function leggiContenuto(payload: unknown): ContenutoNotifica {
	const p = (payload ?? {}) as Record<string, unknown>;
	return {
		titolo: typeof p.titolo === 'string' ? p.titolo : 'Avviso',
		testo: typeof p.testo === 'string' ? p.testo : '',
		url: typeof p.url === 'string' ? p.url : null
	};
}
