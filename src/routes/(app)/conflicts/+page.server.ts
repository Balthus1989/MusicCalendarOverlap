import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import {
	archivia,
	prendiAtto,
	riapri,
	risolviConNota,
	trovaPerIlViewer
} from '$lib/server/conflicts/actions';
import {
	elencaConflitti,
	STATI_ARCHIVIATI,
	STATI_DA_TRATTARE
} from '$lib/server/conflicts/queries';
import { getDb } from '$lib/server/db/client';
import type { Actions, PageServerLoad } from './$types';

/**
 * La dashboard dei conflitti.
 *
 * Non è una casella di posta da svuotare: è il posto dove si legge se due
 * organizzatori si sono già parlati di una data (ADR-0009). Per questo le
 * azioni disponibili registrano una conversazione — preso atto, risolto con
 * una nota, archiviato — e nessuna di esse cambia una data o impedisce
 * qualcosa (ADR-0022).
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const viewer = locals.viewer;
	if (!viewer) error(401, 'Sessione non valida.');

	const archivio = url.searchParams.get('archivio') === '1';
	const db = getDb();

	const conflitti = await elencaConflitti(db, viewer, {
		stati: archivio ? STATI_ARCHIVIATI : STATI_DA_TRATTARE
	});

	return { conflitti, archivio };
};

const notaSchema = z
	.string()
	.trim()
	.min(3, 'Scrivi almeno com’è andata: fra sei mesi sarà l’unica cosa che resta.')
	.max(1000, 'Massimo 1000 caratteri.');

type Contesto =
	| { errore: string; stato: number }
	| {
			errore?: undefined;
			db: ReturnType<typeof getDb>;
			viewer: NonNullable<App.Locals['viewer']>;
			conflitto: NonNullable<Awaited<ReturnType<typeof trovaPerIlViewer>>>;
	  };

/** Le azioni condividono il recupero del conflitto e il controllo di appartenenza. */
async function conIlConflitto(locals: App.Locals, form: FormData): Promise<Contesto> {
	const viewer = locals.viewer;
	if (!viewer) return { errore: 'Sessione non valida.', stato: 401 };

	const id = form.get('conflictId');
	if (typeof id !== 'string' || !id) {
		return { errore: 'Conflitto non indicato.', stato: 400 };
	}

	const db = getDb();
	const conflitto = await trovaPerIlViewer(db, viewer, id);
	// 404 e non 403: dire "esiste ma non ti riguarda" di un conflitto è già
	// dire che due date che non ti riguardano si stanno pestando i piedi.
	if (!conflitto) return { errore: 'Conflitto non trovato.', stato: 404 };

	return { db, viewer, conflitto };
}

export const actions: Actions = {
	prendiAtto: async ({ request, locals }) => {
		const form = await request.formData();
		const ctx = await conIlConflitto(locals, form);
		if (ctx.errore !== undefined) return fail(ctx.stato, { errore: ctx.errore });

		await prendiAtto(ctx.db, ctx.viewer, ctx.conflitto);
		return { fatto: 'Segnato come visto.' };
	},

	risolvi: async ({ request, locals }) => {
		const form = await request.formData();
		const ctx = await conIlConflitto(locals, form);
		if (ctx.errore !== undefined) return fail(ctx.stato, { errore: ctx.errore });

		const nota = notaSchema.safeParse(form.get('nota') ?? '');
		if (!nota.success) {
			return fail(400, { errore: nota.error.issues[0].message, conflictId: ctx.conflitto.id });
		}

		await risolviConNota(ctx.db, ctx.viewer, ctx.conflitto, nota.data);
		return { fatto: 'Conflitto chiuso, con la sua nota.' };
	},

	archivia: async ({ request, locals }) => {
		const form = await request.formData();
		const ctx = await conIlConflitto(locals, form);
		if (ctx.errore !== undefined) return fail(ctx.stato, { errore: ctx.errore });

		const grezza = form.get('nota');
		const nota = typeof grezza === 'string' && grezza.trim() ? grezza.trim().slice(0, 1000) : null;

		await archivia(ctx.db, ctx.viewer, ctx.conflitto, nota);
		return { fatto: 'Archiviato: resta nello storico, non più fra quelli da trattare.' };
	},

	riapri: async ({ request, locals }) => {
		const form = await request.formData();
		const ctx = await conIlConflitto(locals, form);
		if (ctx.errore !== undefined) return fail(ctx.stato, { errore: ctx.errore });

		await riapri(ctx.db, ctx.viewer, ctx.conflitto);
		return { fatto: 'Riaperto.' };
	}
};
