/**
 * I canali di uscita attivi.
 *
 * **In questo momento l'elenco è vuoto**, e non è un errore: l'email è stata
 * rimossa e Telegram arriva nel commit successivo. Fino ad allora il layer
 * registra gli avvisi in `notifications`, la casella in pagina li mostra, e la
 * coda di uscita resta ferma — che è esattamente ciò che già faceva senza
 * chiave configurata ([ADR-0039](../../../../docs/DECISIONS.md)).
 *
 * **L'in-app non è un sink**, e non è una dimenticanza: non esce da nessuna
 * parte. La notifica in pagina *è* la riga in `notifications`, che il layer
 * scrive comunque perché quella tabella è anche la coda di uscita (ADR-0036).
 * Farne un finto canale che non manda niente da nessuna parte avrebbe aggiunto
 * un'astrazione per simmetria.
 */
import type { NotificationSink } from '../types';

/** Tutti i sink previsti, disponibili o no. */
export const SINK: readonly NotificationSink[] = [];

/** Quelli configurati davvero su questa macchina. */
export function sinkAttivi(): NotificationSink[] {
	return SINK.filter((s) => s.disponibile());
}
