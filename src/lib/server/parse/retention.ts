/**
 * La scadenza del registro degli incolla (ADR-0032).
 *
 * `parse_jobs.raw_text` è testo che qualcuno ha copiato da un'altra parte, e
 * un annuncio di concerto contiene regolarmente dati personali di terzi: il
 * numero di chi gestisce le prenotazioni, il nome di chi ospita, a volte un
 * indirizzo di casa. Non sono dati che questo prodotto raccoglie — sono dati
 * che gli arrivano addosso, e §16 impone il minimo necessario.
 *
 * Il minimo necessario, qui, ha una durata: i due usi previsti da §9 punto 5
 * — capire perché un'estrazione è andata male, e misurare quanto bene
 * funziona — vivono entrambi nelle settimane successive all'incolla. A un
 * anno di distanza quel testo non serve più a niente e resta solo un rischio.
 *
 * Non si conserva la riga svuotandola del testo: senza `raw_text` un job non
 * dice più niente di utile, e una tabella di gusci vuoti è solo un modo per
 * non decidere.
 */
import { lt } from 'drizzle-orm';
import type { Database } from '$lib/server/db/client';
import { parseJobs } from '$lib/server/db/schema';

/** Novanta giorni: un trimestre di storico basta a vedere una tendenza. */
export const GIORNI_CONSERVAZIONE = 90;

/**
 * Cancella i job scaduti. Torna quanti ne ha tolti.
 *
 * Idempotente come tutto ciò che gira di notte: rilanciarla subito dopo non
 * trova più niente da fare.
 */
export async function scadiParseJobs(
	db: Database,
	adesso: Date = new Date()
): Promise<{ cancellati: number }> {
	const limite = new Date(adesso.getTime() - GIORNI_CONSERVAZIONE * 86_400_000);
	const tolti = await db.delete(parseJobs).where(lt(parseJobs.createdAt, limite)).returning({
		id: parseJobs.id
	});
	return { cancellati: tolti.length };
}
