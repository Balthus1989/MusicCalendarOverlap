import { error, type RequestHandler } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import { viewerPerProfilo } from '$lib/server/auth/viewer';
import { getDb } from '$lib/server/db/client';
import { elencaEventi } from '$lib/server/events/queries';
import { finestraFeed, segnaAccesso, trovaFeedPerToken } from '$lib/server/feeds/service';
import { tokenBenFormato } from '$lib/server/feeds/token';
import { costruisciCalendario, type VoceFeed } from '$lib/server/ics/build';
import { serializeEvent } from '$lib/server/visibility';

/**
 * Feed ICS sottoscrivibile (ARCHITECTURE.md §8, ADR-0011).
 *
 * **È l'unico endpoint pubblico del prodotto che restituisce dati di dominio**,
 * e lo è per un motivo che non si può aggirare: nessun client calendario sa
 * fare login. L'autenticazione è il token nell'URL, e da questa scelta
 * discende tutto il resto di questo file.
 *
 * Il contenuto è redatto con il **viewer del profilo proprietario del feed**:
 * chi entra in possesso del token vede esattamente ciò che vedrebbe quella
 * persona entrando nell'applicazione, mai un campo di più. Le bozze non ci
 * sono affatto (ADR-0029), e le date altrui in `hold` restano ridotte a
 * giorno, città e genere come ovunque.
 *
 * Non c'è nessun `try` intorno: se il database non risponde è meglio un 500,
 * che il client ritenta fra dodici ore, che un 200 con un calendario vuoto —
 * il quale, in Google Calendar, **cancella tutte le date già importate**.
 */
export const GET: RequestHandler = async ({ params, url, setHeaders }) => {
	const token = params.token ?? '';
	// Un token malformato non arriva nemmeno al database: non è una difesa,
	// è non fare una query per ogni scanner che passa.
	if (!tokenBenFormato(token)) error(404, 'Feed non trovato.');

	const db = getDb();
	const feed = await trovaFeedPerToken(db, token);
	// Revocato e inesistente rispondono allo stesso modo: distinguerli
	// direbbe a chi ha un URL vecchio che quell'URL era buono.
	if (!feed) error(404, 'Feed non trovato.');

	const contesto = await viewerPerProfilo(db, feed.profileId);
	if (!contesto) error(404, 'Feed non trovato.');

	const { da, a } = finestraFeed();
	const eventi = await elencaEventi(db, contesto.viewer, {
		da,
		a,
		statuses: feed.filtri.stati,
		organizationIds: feed.filtri.organizzazioni,
		genreSlugs: feed.filtri.generi,
		centro: feed.filtri.centro,
		raggioKm: feed.filtri.raggioKm
	});

	const voci: VoceFeed[] = [];
	for (const evento of eventi) {
		const serializzato = serializeEvent(evento, contesto.viewer);
		if (!serializzato) continue;
		voci.push({ evento: serializzato, aggiornatoIl: evento.updatedAt });
	}

	const baseUrl = (publicEnv.PUBLIC_APP_URL ?? url.origin).replace(/\/+$/, '');
	const ics = costruisciCalendario(voci, {
		nome: feed.label,
		baseUrl,
		descrizione: `Date visibili a ${contesto.profile.displayName} sul calendario condiviso.`,
		sorgente: `${baseUrl}/api/ics/${feed.token}.ics`
	});

	await segnaAccesso(db, feed.id);

	setHeaders({
		'Content-Type': 'text/calendar; charset=utf-8',
		// `private` perché il contenuto dipende dal token, e un proxy
		// condiviso che lo mettesse in cache lo servirebbe a un altro token.
		// Un'ora contro le dodici di `REFRESH-INTERVAL`: il client torna
		// quando vuole, ma non deve poter ricevere qualcosa di vecchio mezza
		// giornata dopo una modifica.
		'Cache-Control': 'private, max-age=3600',
		// Il token è un segreto in un URL: quell'URL non deve finire in un
		// indice, né in un `Referer` verso i siti linkati nelle descrizioni.
		'X-Robots-Tag': 'noindex, nofollow',
		'Referrer-Policy': 'no-referrer',
		'Content-Disposition': `inline; filename="${feed.token}.ics"`
	});

	return new Response(ics);
};
