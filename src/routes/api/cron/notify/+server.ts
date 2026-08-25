import { json, type RequestHandler } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/client';
import { avvisiSollecito } from '$lib/server/notifications/annunci';
import { consegnaArretrate, notifica } from '$lib/server/notifications/service';

/**
 * Le due cose che le notifiche devono fare ogni notte.
 *
 * **I solleciti** sulle date opzionate che hanno superato la scadenza di
 * annuncio (§10, riga 5): è una scansione, non un fatto puntuale, e non
 * poteva quindi partire dal salvataggio come fanno i conflitti — la data non
 * cambia, cambia il calendario.
 *
 * **Il ritentativo delle consegne rimaste in coda** (ADR-0036): la tabella
 * `notifications` è anche la coda di uscita, e le righe con `consegnata_at` a
 * `NULL` sono i messaggi dovuti che non sono usciti. La notte in cui un canale
 * mal configurato torna a posto, partono tutti.
 *
 * Sta insieme al ricalcolo nella stessa GitHub Action e non in una in più:
 * aggiungere uno scheduler per un `curl` sarebbe il contrario di ADR-0013.
 *
 * Il segreto lo verifica `cronGuard` in `hooks.server.ts`.
 */
export const POST: RequestHandler = async () => {
	const inizio = Date.now();
	const db = getDb();

	const solleciti = await notifica(db, await avvisiSollecito(db));
	const arretrate = await consegnaArretrate(db);

	return json(
		{ solleciti, arretrate, durataMs: Date.now() - inizio },
		{ headers: { 'Cache-Control': 'private, no-store' } }
	);
};
