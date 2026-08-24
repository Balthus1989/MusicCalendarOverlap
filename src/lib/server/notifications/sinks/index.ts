/**
 * I canali di uscita attivi.
 *
 * Oggi ce n'è **uno**, e l'interfaccia esiste comunque perché ARCHITECTURE.md
 * §10 lo chiede per nome: la community ha già un canale Telegram, e la
 * domanda se usarlo è una decisione aperta di questa fase (#6 in
 * `DECISIONS.md`, da chiudere parlando con gli organizzatori e non a tavolino).
 * Quando si chiuderà, se in positivo, sarà un file accanto a `email.ts` e una
 * riga in questo elenco.
 *
 * **L'in-app non è un sink**, e non è una dimenticanza: non esce da nessuna
 * parte. La notifica in-app *è* la riga in `notifications`, che il layer
 * scrive comunque perché quella tabella è anche la coda di uscita delle email
 * (ADR-0036). Farne un finto canale che non manda niente da nessuna parte
 * avrebbe aggiunto un'astrazione per simmetria.
 */
import { sinkEmail } from './email';
import type { NotificationSink } from '../types';

/** Tutti i sink previsti, disponibili o no. */
export const SINK: readonly NotificationSink[] = [sinkEmail];

/** Quelli configurati davvero su questa macchina. */
export function sinkAttivi(): NotificationSink[] {
	return SINK.filter((s) => s.disponibile());
}

export { sinkEmail };
