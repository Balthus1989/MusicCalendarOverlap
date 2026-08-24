/**
 * Il registro delle modifiche, consultabile (ARCHITECTURE.md §4.6, Fase 6).
 *
 * Fino a qui `audit_log` si scriveva e non si leggeva: la traccia c'era ma
 * rispondeva solo a chi sapeva aprire il database. La domanda per cui esiste è
 * ordinaria — «questa data è cambiata, chi e quando?» — e finché la risposta
 * richiede una query a mano, la tabella è un buon proposito.
 *
 * Insieme al registro c'è la **metrica di §1**, che si legge dalle stesse
 * righe: la quota di date che passano da `hold` prima di arrivare a
 * `confirmed`. È la misura che dice se il prodotto sta facendo il suo lavoro o
 * se è diventato un archivio di annunci già fatti, e stava in un paragrafo del
 * documento di architettura senza nessun posto in cui guardarla.
 */
import { error } from '@sveltejs/kit';
import { metricaHold } from '$lib/audit';
import { passaggiDiStato, registroDelleOrganizzazioni } from '$lib/server/audit';
import { getDb } from '$lib/server/db/client';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const viewer = locals.viewer;
	if (!viewer) error(401, 'Sessione non valida.');

	const db = getDb();

	return {
		voci: await registroDelleOrganizzazioni(db, viewer),
		metrica: metricaHold(await passaggiDiStato(db, viewer))
	};
};
