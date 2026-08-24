/**
 * Dagli avvisi del motore conflitti alle notifiche (§6.4 punto 3, §10).
 *
 * Il pezzo delicato di tutta la fase sta in venti righe, ed è questo: un
 * conflitto **si serializza una volta per organizzazione**, non una volta per
 * conflitto, perché quanto se ne può raccontare dipende da chi guarda
 * (ADR-0024). Se `serializeConflict` restituisce `null` per un lato, quel lato
 * non riceve niente — non un'email senza nomi, proprio niente: il caso
 * obbligatorio è la band che una sola delle due organizzazioni ha annunciato,
 * dove anche il solo fatto che un conflitto esista direbbe chi l'ha ingaggiata.
 *
 * Tutti i membri della stessa organizzazione ricevono lo stesso testo. È
 * corretto perché la visibilità dipende dall'appartenenza e non dal ruolo né
 * dalla persona (§5), e permette di serializzare due volte invece che una per
 * ciascun iscritto.
 */
import { and, eq, inArray, or } from 'drizzle-orm';
import type { Database } from '$lib/server/db/client';
import { conflicts, events } from '$lib/server/db/schema';
import { meritaNotifica, type ConflittoTrovato } from '$lib/server/conflicts/engine';
import { conflittiPerId } from '$lib/server/conflicts/queries';
import type { EsitoRiconciliazione } from '$lib/server/conflicts/reconcile';
import type { ViewerContext } from '$lib/server/visibility';
import { membriPerOrganizzazione } from './destinatari';
import { avvisoConflittoNuovo, avvisoConflittoRisolto } from './messages';
import type { Avviso } from './types';

/**
 * Il contesto di visibilità di un'**organizzazione**, non di una persona.
 *
 * `serializeEvent` e `serializeConflict` guardano solo `organizationIds`: il
 * ruolo non entra nel calcolo di cosa si vede, e `isPlatformAdmin` non è un
 * lasciapassare (ADR-0019). Il `profileId` vuoto non è quindi un buco, è la
 * prova che la redazione non dipende dalla persona.
 */
function viewerDiOrganizzazione(organizationId: string): ViewerContext {
	return { profileId: '', organizationIds: [organizationId], roles: {}, isPlatformAdmin: false };
}

/**
 * Le organizzazioni toccate da ciascun conflitto, in una query sola.
 *
 * Il join è su «l'evento è uno dei due della coppia», quindi ogni conflitto
 * torna in due righe e si ricompone qui. Un `Set` e non un array: se per un
 * errore di dati le due date fossero dello stesso circolo, avvisarlo due volte
 * sarebbe la seconda stranezza dopo la prima.
 */
async function organizzazioniDeiConflitti(
	db: Database,
	ids: string[]
): Promise<Map<string, Set<string>>> {
	const righe = await db
		.select({ id: conflicts.id, organizationId: events.organizationId })
		.from(conflicts)
		.innerJoin(events, or(eq(events.id, conflicts.eventAId), eq(events.id, conflicts.eventBId)))
		.where(inArray(conflicts.id, ids));

	const mappa = new Map<string, Set<string>>();
	for (const r of righe) {
		const insieme = mappa.get(r.id) ?? new Set<string>();
		insieme.add(r.organizationId);
		mappa.set(r.id, insieme);
	}
	return mappa;
}

/** Trova gli id persistiti dei conflitti che il motore ha appena segnalato come nuovi. */
async function idDeiTrovati(db: Database, trovati: ConflittoTrovato[]): Promise<string[]> {
	if (!trovati.length) return [];

	const righe = await db
		.select({ id: conflicts.id })
		.from(conflicts)
		.where(
			or(
				...trovati.map((t) =>
					and(
						eq(conflicts.eventAId, t.eventAId),
						eq(conflicts.eventBId, t.eventBId),
						eq(conflicts.kind, t.kind)
					)
				)
			)
		);

	return righe.map((r) => r.id);
}

/**
 * Costruisce gli avvisi per un insieme di conflitti, uno per membro di
 * ciascuna delle due organizzazioni che può sentirseli raccontare.
 */
async function avvisiPerConflitti(
	db: Database,
	ids: string[],
	costruisci: typeof avvisoConflittoNuovo
): Promise<Avviso[]> {
	if (!ids.length) return [];

	const orgPerConflitto = await organizzazioniDeiConflitti(db, ids);
	const tutteLeOrg = [...new Set([...orgPerConflitto.values()].flatMap((s) => [...s]))];
	if (!tutteLeOrg.length) return [];

	const membri = await membriPerOrganizzazione(db, tutteLeOrg);

	const avvisi: Avviso[] = [];
	for (const organizationId of tutteLeOrg) {
		const destinatari = membri.get(organizationId) ?? [];
		if (!destinatari.length) continue;

		// Gli id di questo giro: i conflitti che toccano questa organizzazione.
		const suoi = ids.filter((id) => orgPerConflitto.get(id)?.has(organizationId));
		const redatti = await conflittiPerId(db, suoi, viewerDiOrganizzazione(organizationId));

		for (const conflitto of redatti) {
			for (const destinatario of destinatari) {
				avvisi.push(costruisci(conflitto, destinatario));
			}
		}
	}

	return avvisi;
}

/**
 * Gli avvisi per i conflitti nuovi di una riconciliazione (§10, riga 1).
 *
 * Filtra a `medium` e `high` come chiede la specifica: un `low` è
 * un'informazione utile in dashboard — quella sera la zona è viva — ma non è
 * una cosa per cui valga la pena far vibrare il telefono di qualcuno.
 */
export async function avvisiConflittiNuovi(
	db: Database,
	esito: EsitoRiconciliazione
): Promise<Avviso[]> {
	const daAvvisare = esito.nuovi.filter((c) => meritaNotifica(c.severity));
	if (!daAvvisare.length) return [];

	const ids = await idDeiTrovati(db, daAvvisare);
	return avvisiPerConflitti(db, ids, avvisoConflittoNuovo);
}

/** Gli avvisi per un conflitto chiuso da una persona (§10, riga 2). Solo in-app. */
export async function avvisiConflittoRisolto(db: Database, conflictId: string): Promise<Avviso[]> {
	return avvisiPerConflitti(db, [conflictId], avvisoConflittoRisolto);
}
