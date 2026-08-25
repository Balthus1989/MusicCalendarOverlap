/**
 * I canali di uscita attivi.
 *
 * Oggi ce n'è **uno**, Telegram, e l'interfaccia esiste perché
 * ARCHITECTURE.md §10 la chiedeva per nome. In Fase 6 ha già ripagato: il
 * canale è passato dall'email a Telegram sostituendo un file in questa
 * cartella, e il resto del layer non se n'è accorto
 * ([ADR-0039](../../../../docs/DECISIONS.md)).
 *
 * **L'in-app non è un sink**, e non è una dimenticanza: non esce da nessuna
 * parte. La notifica in pagina *è* la riga in `notifications`, che il layer
 * scrive comunque perché quella tabella è anche la coda di uscita (ADR-0036).
 * Farne un finto canale che non manda niente da nessuna parte avrebbe aggiunto
 * un'astrazione per simmetria.
 */
import { sinkTelegram } from './telegram';
import type { NotificationSink } from '../types';

/** Tutti i sink previsti, disponibili o no. */
export const SINK: readonly NotificationSink[] = [sinkTelegram];

/** Quelli configurati davvero su questa macchina. */
export function sinkAttivi(): NotificationSink[] {
	return SINK.filter((s) => s.disponibile());
}

export { sinkTelegram };
