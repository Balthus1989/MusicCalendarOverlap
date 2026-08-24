/**
 * Pulizia dopo gli smoke test.
 *
 * Gira **anche quando i test falliscono**: è un progetto di `teardown` di
 * Playwright, non un `afterAll`. Lasciare in giro due organizzazioni e due
 * utenti perché una asserzione è andata male sarebbe il modo più rapido per
 * far smettere il manutentore di lanciare questi test contro il suo database.
 */
import { test as pulizia } from '@playwright/test';
import { apriAdmin, apriDb, pulisciAmbiente } from './dati.ts';

pulizia('rimuove utenti, organizzazioni e date di prova', async () => {
	pulizia.setTimeout(60_000);

	const admin = apriAdmin();
	const { sql, db } = apriDb();
	try {
		await pulisciAmbiente(db, admin);
	} finally {
		await sql.end({ timeout: 5 }).catch(() => {});
	}
});
