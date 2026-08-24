/**
 * Il sollecito sulle date opzionate scadute (§10, riga 5).
 *
 * `announce_at` è la data entro cui chi ha opzionato contava di annunciare.
 * Quando passa e la data è ancora `hold`, di solito è successa una di due
 * cose: l'annuncio c'è stato ma qui non è stato registrato — e allora gli
 * altri iscritti stanno guardando una riga più povera del vero — oppure la
 * serata è saltata e lo slot è occupato per niente.
 *
 * In nessuno dei due casi il calendario decide: manda un promemoria e si ferma
 * lì. È la stessa regola di ADR-0022, applicata al proprio cortile.
 */
import { and, eq, gte, isNotNull, lte } from 'drizzle-orm';
import type { Database } from '$lib/server/db/client';
import { events } from '$lib/server/db/schema';
import { caricaEventi } from '$lib/server/events/queries';
import { serializeEvent, type ViewerContext } from '$lib/server/visibility';
import { membriPerOrganizzazione } from './destinatari';
import { avvisoSollecito } from './messages';
import type { Avviso } from './types';

/**
 * Le date che meritano un sollecito, con gli avvisi già costruiti.
 *
 * L'evento appartiene per forza all'organizzazione di chi lo riceve — è
 * l'unica che vede `announce_at` (§5) — quindi la serializzazione è sempre
 * completa e non c'è niente da redigere. Ci si passa comunque: la regola per
 * cui nessun testo si costruisce su una riga grezza non ha eccezioni comode.
 */
export async function avvisiSollecito(db: Database, adesso = new Date()): Promise<Avviso[]> {
	const scadute = await db
		.select({ id: events.id, organizationId: events.organizationId })
		.from(events)
		.where(
			and(
				eq(events.status, 'hold'),
				isNotNull(events.announceAt),
				lte(events.announceAt, adesso),
				// Una data già passata non si annuncia più: il promemoria
				// arriverebbe per una serata che è successa o non è successa, e
				// in nessuno dei due casi c'è qualcosa da fare.
				gte(events.startsAt, adesso)
			)
		)
		.limit(200);

	if (!scadute.length) return [];

	const eventi = await caricaEventi(
		db,
		scadute.map((e) => e.id)
	);
	const membri = await membriPerOrganizzazione(db, [
		...new Set(scadute.map((e) => e.organizationId))
	]);

	const avvisi: Avviso[] = [];
	for (const evento of eventi) {
		const viewer: ViewerContext = {
			profileId: '',
			organizationIds: [evento.organizationId],
			roles: {},
			isPlatformAdmin: false
		};
		const serializzato = serializeEvent(evento, viewer);
		if (!serializzato || serializzato.visibilita !== 'completa') continue;

		for (const destinatario of membri.get(evento.organizationId) ?? []) {
			avvisi.push(avvisoSollecito(serializzato, destinatario));
		}
	}

	return avvisi;
}
