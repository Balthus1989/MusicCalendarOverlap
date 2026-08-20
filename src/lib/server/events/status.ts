/**
 * Macchina a stati dell'evento (ADR-0005, ARCHITECTURE.md §12 Fase 2).
 *
 * Codice puro: nessuna query, nessun permesso. Chi può cambiare stato lo
 * decide `auth/permissions.ts`; *quali* cambi hanno senso lo decide questo
 * file.
 *
 * La regola che tiene insieme tutto: `draft` significa "nessun altro l'ha mai
 * visto". Appena un evento passa a `hold`, quell'affermazione smette di essere
 * vera per sempre, e nessun cambio di stato può renderla vera di nuovo. Per
 * questo si esce da `draft` ma non ci si rientra: un ritorno indietro darebbe
 * l'illusione di aver ritirato un'informazione che altri hanno già letto.
 * Per togliere una data dal calendario altrui esiste `cancelled`, che è
 * onesto: dice che quella serata non si fa.
 */
import { DESCRIZIONI_STATO, ETICHETTE_STATO } from '$lib/events';
import type { EventStatus } from '$lib/server/db/schema';

// Le etichette servono anche al browser, quindi vivono fuori da `$lib/server`.
// Si ri-esportano perché chi lavora sugli stati le cerca qui.
export { DESCRIZIONI_STATO, ETICHETTE_STATO };

export type MotivoBloccante = { campo: string; messaggio: string };

/** Stati raggiungibili da ciascuno stato. */
export const TRANSIZIONI: Record<EventStatus, readonly EventStatus[]> = {
	// L'anticamera privata: da qui si va ovunque.
	draft: ['hold', 'confirmed', 'cancelled'],
	// Annunciabile o annullabile, mai richiudibile in bozza.
	hold: ['confirmed', 'cancelled'],
	// Il rientro in `hold` copre l'annuncio ritirato: è raro, ma succede, e
	// l'alternativa sarebbe annullare una data che invece si farà.
	confirmed: ['hold', 'cancelled'],
	// Una data annullata che si recupera è ordinaria amministrazione.
	cancelled: ['hold', 'confirmed']
};

export function transizioniAmmesse(da: EventStatus): readonly EventStatus[] {
	return TRANSIZIONI[da];
}

/** Vero se il passaggio è ammesso. Restare fermi è sempre ammesso. */
export function puoTransire(da: EventStatus, a: EventStatus): boolean {
	if (da === a) return true;
	return TRANSIZIONI[da].includes(a);
}

/**
 * Dati minimi che uno stato richiede.
 *
 * È l'unico punto di tutto il prodotto in cui qualcosa viene *bloccato*: un
 * conflitto avvisa e basta (ADR-0009), ma una data confermata senza locale non
 * è una scelta strategica, è un campo dimenticato. Chi la legge nel calendario
 * degli altri non saprebbe dove andare.
 */
export function motiviCheImpediscono(
	stato: EventStatus,
	evento: { title: string; city: string; venueId: string | null; startsAt: Date | null }
): MotivoBloccante[] {
	const motivi: MotivoBloccante[] = [];

	if (!evento.title.trim()) {
		motivi.push({ campo: 'title', messaggio: 'Serve un titolo, anche provvisorio.' });
	}
	if (!evento.startsAt) {
		motivi.push({ campo: 'startsAt', messaggio: 'Serve una data di inizio.' });
	}
	// La città regge il calcolo geografico anche quando il locale non c'è
	// ancora (ADR-0008): senza, l'evento è invisibile al motore conflitti.
	if (!evento.city.trim()) {
		motivi.push({ campo: 'city', messaggio: 'Serve almeno la città.' });
	}

	if (stato === 'confirmed' && !evento.venueId) {
		motivi.push({
			campo: 'venueId',
			messaggio: 'Per confermare una data serve il locale. Finché non lo sai, tienila opzionata.'
		});
	}

	return motivi;
}

/** Testo per il registro di audit: resta leggibile fra sei mesi. */
export function descriviTransizione(da: EventStatus, a: EventStatus): string {
	return `${ETICHETTE_STATO[da]} → ${ETICHETTE_STATO[a]}`;
}

/**
 * Vero se il cambio di stato allarga ciò che gli altri vedono.
 *
 * Serve all'interfaccia, che deve avvisare prima e non dopo: passare da
 * `hold` a `confirmed` pubblica il titolo, il locale e la lineup annunciata.
 */
export function allargaLaVisibilita(da: EventStatus, a: EventStatus): boolean {
	const livello: Record<EventStatus, number> = { draft: 0, hold: 1, confirmed: 2, cancelled: 2 };
	return livello[a] > livello[da];
}
