import { error, json, type RequestHandler } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db/client';
import { organizations } from '$lib/server/db/schema';
import { valoriPredefiniti } from '$lib/server/events/form';
import { opzioniForm } from '$lib/server/events/queries';
import { canCreateEvent } from '$lib/server/auth/permissions';
import { importaDaTesto } from '$lib/server/parse/service';
import { llmConfigurato } from '$lib/server/parse/llm';

/**
 * Paste-to-parse (ARCHITECTURE.md §9, ADR-0010).
 *
 * Riceve il testo incollato e restituisce **valori da mettere nel form**. Non
 * scrive nessun evento, non tocca nessuna riga di `events`: l'unica scrittura
 * possibile è la riga di registro in `parse_jobs`. Chi rivede e salva è una
 * persona, sempre (ADR-0031).
 *
 * È un `POST` perché manda un corpo lungo, non perché crei una risorsa — la
 * stessa ragione per cui lo è `/api/conflicts/preview`.
 *
 * `organizationId` arriva dal form ed è **verificato**, non creduto: i valori
 * di partenza contengono la città e l'identità dell'organizzazione, e
 * restituirli per un'organizzazione di cui chi chiede non fa parte sarebbe far
 * uscire un dato dalla porta di servizio.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const viewer = locals.viewer;
	if (!viewer) error(401, 'Serve una sessione.');

	const form = await request.formData();
	const testo = String(form.get('testo') ?? '');
	const organizationId = String(form.get('organizationId') ?? '');

	if (!canCreateEvent(viewer, organizationId)) {
		error(403, 'Puoi preparare date solo per le organizzazioni di cui fai parte.');
	}

	const db = getDb();

	const righe = await db
		.select({ id: organizations.id, city: organizations.city, province: organizations.province })
		.from(organizations)
		.where(eq(organizations.id, organizationId))
		.limit(1);

	const org = righe[0];
	if (!org) error(404, 'Organizzazione non trovata.');

	const { locali, generi } = await opzioniForm(db);

	const esito = await importaDaTesto(db, viewer.profileId, testo, {
		base: valoriPredefiniti(org),
		generi,
		locali
	});

	return json(
		{ ...esito, llmConfigurato: llmConfigurato() },
		// Dipende da chi chiede e da cosa ha incollato: non è cacheabile da
		// nessuno, e meno che mai da una cache condivisa.
		{ headers: { 'Cache-Control': 'private, no-store' } }
	);
};
