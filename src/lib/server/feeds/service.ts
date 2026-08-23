/**
 * Accesso al database per i feed ICS (ARCHITECTURE.md §8).
 *
 * Sta accanto al costruttore ICS senza mescolarsi: `ics/build.ts` è codice
 * puro e si testa caso per caso, qui c'è l'I/O. È la stessa divisione del
 * motore conflitti fra `rules.ts` e `reconcile.ts`, per la stessa ragione.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '$lib/server/db/client';
import { calendarFeeds, type CalendarFeed } from '$lib/server/db/schema';
import { leggiFiltri, type FiltriFeed } from '$lib/schemas/feed';
import { generaTokenFeed } from './token';

/** Quanto indietro guarda un feed. Le date passate servono da storico. */
export const MESI_INDIETRO = 3;

/** Quanto avanti: la stessa finestra del ricalcolo notturno. */
export const MESI_AVANTI = 18;

export type FeedConFiltri = {
	id: string;
	token: string;
	label: string;
	filtri: FiltriFeed;
	lastAccessedAt: Date | null;
	revokedAt: Date | null;
	createdAt: Date;
};

function conFiltri(riga: CalendarFeed): FeedConFiltri {
	return {
		id: riga.id,
		token: riga.token,
		label: riga.label,
		filtri: leggiFiltri(riga.filters),
		lastAccessedAt: riga.lastAccessedAt,
		revokedAt: riga.revokedAt,
		createdAt: riga.createdAt
	};
}

/** La finestra temporale che un feed copre, a partire da un istante. */
export function finestraFeed(adesso: Date = new Date()): { da: Date; a: Date } {
	const da = new Date(adesso);
	da.setUTCMonth(da.getUTCMonth() - MESI_INDIETRO);
	const a = new Date(adesso);
	a.setUTCMonth(a.getUTCMonth() + MESI_AVANTI);
	return { da, a };
}

/**
 * I feed di un profilo, revocati compresi.
 *
 * I revocati si mostrano ancora: senza, chi ha appena disdetto un feed non ha
 * nessuna conferma che l'operazione sia servita a qualcosa.
 */
export async function elencaFeed(db: Database, profileId: string): Promise<FeedConFiltri[]> {
	const righe = await db
		.select()
		.from(calendarFeeds)
		.where(eq(calendarFeeds.profileId, profileId))
		.orderBy(desc(calendarFeeds.createdAt));
	return righe.map(conFiltri);
}

export async function creaFeed(
	db: Database,
	profileId: string,
	label: string,
	filtri: FiltriFeed
): Promise<FeedConFiltri> {
	const [riga] = await db
		.insert(calendarFeeds)
		.values({ profileId, label, token: generaTokenFeed(), filters: filtri })
		.returning();
	return conFiltri(riga);
}

/**
 * Revoca un feed. Non lo cancella: il token resta occupato, così un URL
 * ancora in circolazione non può essere riassegnato a un feed nuovo per una
 * collisione fortunata.
 */
export async function revocaFeed(db: Database, profileId: string, id: string): Promise<boolean> {
	const righe = await db
		.update(calendarFeeds)
		.set({ revokedAt: new Date() })
		.where(
			and(
				eq(calendarFeeds.id, id),
				// Il vincolo di proprietà sta **nella `WHERE`**: un controllo
				// fatto prima, in una lettura separata, lascerebbe la scrittura
				// capace di toccare la riga di chiunque se qualcuno un giorno
				// chiamasse questa funzione da un'altra strada.
				eq(calendarFeeds.profileId, profileId),
				isNull(calendarFeeds.revokedAt)
			)
		)
		.returning({ id: calendarFeeds.id });
	return righe.length > 0;
}

/** Il feed corrispondente a un token, se esiste e non è revocato. */
export async function trovaFeedPerToken(
	db: Database,
	token: string
): Promise<(FeedConFiltri & { profileId: string }) | null> {
	const righe = await db
		.select()
		.from(calendarFeeds)
		.where(and(eq(calendarFeeds.token, token), isNull(calendarFeeds.revokedAt)))
		.limit(1);

	const riga = righe[0];
	return riga ? { ...conFiltri(riga), profileId: riga.profileId } : null;
}

/**
 * Segna che il feed è stato letto.
 *
 * Non solleva: un client calendario che interroga il feed non deve restare
 * senza risposta perché non si è riusciti a scrivere una data di accesso. È la
 * stessa scelta del registro di audit.
 */
export async function segnaAccesso(db: Database, id: string): Promise<void> {
	try {
		await db
			.update(calendarFeeds)
			.set({ lastAccessedAt: new Date() })
			.where(eq(calendarFeeds.id, id));
	} catch (err) {
		console.error('Ultimo accesso al feed non registrato:', err);
	}
}
