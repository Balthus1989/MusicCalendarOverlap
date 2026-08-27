/**
 * Rate limit sugli endpoint che chiamano qualcun altro (ARCHITECTURE.md §16,
 * [ADR-0037](../../../docs/DECISIONS.md)).
 *
 * Due endpoint, due ragioni diverse. `/api/geocode` è un **proxy** verso
 * Photon e Nominatim, che hanno una policy d'uso da rispettare: chi esagera
 * qui fa bloccare l'IP a tutto il progetto, e a rimetterci sarebbe anche
 * l'inserimento dei locali, che funziona. `/api/ics/[token].ics` è l'unico
 * endpoint pubblico che restituisce dati, e un URL pubblico senza limite è un
 * amplificatore per chiunque lo trovi.
 *
 * Il contatore sta nel database e non in memoria: su Cloudflare gli isolate
 * vanno e vengono, e un limite che si azzera a ogni risveglio non è un limite.
 * È la stessa conclusione di ADR-0034, con una differenza — là le righe da
 * contare esistevano già (`parse_jobs`), qui no.
 *
 * La parte che decide sta in `chiaveFinestra()` ed è pura: la finestra è
 * **fissa**, non scorrevole, ed è codificata nella chiave. Costa un caso
 * limite noto — a cavallo di due finestre si possono fare quasi due volte il
 * limite — e in cambio non richiede di tenere la storia delle richieste.
 * Contro un ciclo impazzito, che è il caso da cui questi limiti difendono,
 * fanno lo stesso lavoro.
 */
import { lt, sql } from 'drizzle-orm';
import type { Database } from '$lib/server/db/client';
import { rateLimits } from '$lib/server/db/schema';

export type Risorsa = 'geocode' | 'ics' | 'inviti';

/**
 * I limiti, per finestra di un'ora.
 *
 * `geocode` è pensato su una persona che compila il form di un locale: la
 * ricerca parte mentre si scrive, e sessanta chiamate in un'ora sono già
 * abbondanti per una giornata di inserimenti.
 *
 * `ics` è pensato su un client calendario, che rilegge ogni dodici ore
 * (`REFRESH-INTERVAL`). Ventiquattro all'ora lasciano spazio a più client
 * sullo stesso token — telefono, portatile, Google e Apple insieme — e a
 * qualche ricarica a mano mentre si prova il feed, e restano lontanissime da
 * un ciclo.
 *
 * `inviti` difende da una cosa diversa dalle altre due: non da un ciclo, ma
 * dalla **casella personale del manutentore**. Ogni invito con un indirizzo fa
 * partire un'email dalla sua Gmail, che ha un tetto giornaliero e una
 * reputazione da non bruciare, e chi preme il pulsante e' un amministratore
 * di circolo, non il manutentore. Dieci all'ora sono molti piu' di quanti se
 * ne mandino davvero in un pomeriggio di ingressi, e molti meno di quanti ne
 * servano per fare danno (ADR-0045).
 */
export const LIMITI: Record<Risorsa, number> = {
	geocode: 60,
	ics: 24,
	inviti: 10
};

export const FINESTRA_MS = 60 * 60 * 1000;

/**
 * La chiave della finestra corrente.
 *
 * L'istante è troncato all'inizio della finestra, così tutte le richieste
 * della stessa ora finiscono sulla stessa riga e la successiva ne apre una
 * nuova senza che nessuno debba azzerare niente.
 */
export function chiaveFinestra(
	risorsa: Risorsa,
	identita: string,
	adesso: Date,
	finestraMs = FINESTRA_MS
): string {
	const inizio = Math.floor(adesso.getTime() / finestraMs) * finestraMs;
	return `${risorsa}:${identita}:${inizio}`;
}

/** Quando la riga di quella finestra smette di servire. */
export function scadenzaFinestra(adesso: Date, finestraMs = FINESTRA_MS): Date {
	const inizio = Math.floor(adesso.getTime() / finestraMs) * finestraMs;
	// Due finestre di margine: la riga non serve più subito dopo la sua, ma
	// tenerla un po' evita che la pulizia notturna corra dietro all'orologio.
	return new Date(inizio + 2 * finestraMs);
}

export type EsitoLimite = {
	consentito: boolean;
	/** Quante richieste sono state fatte in questa finestra, questa compresa. */
	usate: number;
	limite: number;
	/** Secondi da aspettare prima che la finestra cambi. Va nell'header `Retry-After`. */
	riprovaFra: number;
};

export function secondiAllaProssimaFinestra(adesso: Date, finestraMs = FINESTRA_MS): number {
	const inizio = Math.floor(adesso.getTime() / finestraMs) * finestraMs;
	return Math.max(1, Math.ceil((inizio + finestraMs - adesso.getTime()) / 1000));
}

/**
 * Registra una richiesta e dice se può passare.
 *
 * L'incremento è un `INSERT … ON CONFLICT DO UPDATE … RETURNING`: atomico, e
 * quindi corretto anche con due richieste in volo insieme. Un
 * letto-poi-scritto in JavaScript, che è la versione che viene in mente per
 * prima, lascerebbe passare entrambe proprio nel momento in cui il limite
 * serve.
 *
 * **In caso di errore lascia passare.** Un contatore che non risponde non deve
 * spegnere il geocoding né un feed sottoscritto in Google Calendar: il rischio
 * di un limite mancato è più piccolo di quello di un'applicazione che si
 * blocca perché una tabella accessoria ha un problema.
 */
export async function consumaRichiesta(
	db: Database,
	risorsa: Risorsa,
	identita: string,
	adesso = new Date()
): Promise<EsitoLimite> {
	const limite = LIMITI[risorsa];
	const riprovaFra = secondiAllaProssimaFinestra(adesso);

	try {
		const [riga] = await db
			.insert(rateLimits)
			.values({
				bucket: chiaveFinestra(risorsa, identita, adesso),
				hits: 1,
				expiresAt: scadenzaFinestra(adesso)
			})
			.onConflictDoUpdate({
				target: rateLimits.bucket,
				set: { hits: sql`${rateLimits.hits} + 1` }
			})
			.returning({ hits: rateLimits.hits });

		const usate = riga?.hits ?? 1;
		return { consentito: usate <= limite, usate, limite, riprovaFra };
	} catch (err) {
		console.error(`Contatore di rate limit non disponibile (${risorsa}):`, err);
		return { consentito: true, usate: 0, limite, riprovaFra };
	}
}

/** Le righe di finestre ormai passate. Le porta via la corsa notturna. */
export async function scadiRateLimit(
	db: Database,
	adesso = new Date()
): Promise<{ cancellate: number }> {
	const righe = await db
		.delete(rateLimits)
		// `lt` e non un `sql` scritto a mano: dentro un template grezzo la
		// `Date` non passa dal codificatore della colonna e arriva a Postgres
		// come il testo di `toString()` — "Mon Aug 24 2026 15:35:31 GMT+0200
		// (Ora legale dell'Europa centrale)" — che nessun `timestamptz` sa
		// leggere. La corsa notturna rispondeva 500 su questa riga.
		.where(lt(rateLimits.expiresAt, adesso))
		.returning({ bucket: rateLimits.bucket });
	return { cancellate: righe.length };
}
