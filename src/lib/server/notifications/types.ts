/**
 * Il contratto del layer di notifica (ARCHITECTURE.md §10, ADR-0035).
 *
 * `NotificationSink` esiste perché la specifica lo chiede per nome: la
 * community ha già un canale Telegram, e se un giorno si deciderà di usarlo
 * (decisione aperta #6 in `DECISIONS.md`) dovrà essere un file in più in
 * `sinks/`, non una riscrittura. Il resto del codice non sa quali sink
 * esistono: costruisce avvisi e li consegna.
 *
 * Il file è codice puro: nessuna query, nessun `fetch`. Le tabelle di
 * decisione — quale avviso va per email, quale interruttore lo governa — si
 * leggono qui e si testano senza database.
 */
import type { NotificationKind } from '$lib/server/db/schema';

/** Chi riceve. L'email c'è sempre: è il campo su cui si fa il login. */
export type Destinatario = {
	profileId: string;
	displayName: string;
	email: string;
};

/**
 * Un avviso pronto da consegnare, **già redatto per il suo destinatario**.
 *
 * Nasce con dentro il testo definitivo e non con gli id da cui ricavarlo:
 * la redazione dipende da chi guarda (ADR-0024), e farla una volta sola al
 * momento giusto è l'unico modo perché l'email e la riga in-app raccontino la
 * stessa cosa.
 */
export type Avviso = {
	kind: NotificationKind;
	destinatario: Destinatario;
	titolo: string;
	testo: string;
	/** Percorso interno, senza dominio: chi manda l'email ci mette davanti `PUBLIC_APP_URL`. */
	url: string | null;
	/**
	 * Identità dell'avviso, per non ripeterlo. `null` per ciò che nasce da un
	 * fatto puntuale — un conflitto rilevato adesso — e non da una scansione
	 * che ripasserà domani sulle stesse righe.
	 */
	dedupeKey: string | null;
};

/**
 * Quali avvisi prevedono una copia per email (§10).
 *
 * La riga in `notifications` viene scritta **sempre**, anche per ciò che §10
 * manda solo per posta: quella tabella è anche la coda di uscita delle email
 * (ADR-0036), e nascondere in-app un avviso già spedito significherebbe
 * costruire un filtro il cui unico effetto è far dimenticare
 * all'applicazione di aver scritto a qualcuno.
 */
export const EMAIL_PREVISTA: Record<NotificationKind, boolean> = {
	conflitto_nuovo: true,
	conflitto_risolto: false,
	invito: true,
	digest_settimanale: true,
	sollecito_annuncio: true
};

/** Gli interruttori di `notification_prefs`, uno per famiglia di avvisi. */
export type Preferenze = {
	emailConflitti: boolean;
	emailDigest: boolean;
	emailSolleciti: boolean;
};

/** Nessuna riga in tabella vale "tutto acceso": il silenzio non si eredita da una dimenticanza. */
export const PREFERENZE_PREDEFINITE: Preferenze = {
	emailConflitti: true,
	emailDigest: true,
	emailSolleciti: true
};

/**
 * Quale interruttore governa quale avviso. `null` significa "non
 * disattivabile": l'invito arriva a chi non ha ancora un profilo su cui
 * esprimere una preferenza, e il conflitto risolto non manda email comunque.
 */
const INTERRUTTORE: Record<NotificationKind, keyof Preferenze | null> = {
	conflitto_nuovo: 'emailConflitti',
	conflitto_risolto: null,
	invito: null,
	digest_settimanale: 'emailDigest',
	sollecito_annuncio: 'emailSolleciti'
};

/** Se per questo avviso, con queste preferenze, va spedita un'email. */
export function vuoleEmail(kind: NotificationKind, preferenze: Preferenze): boolean {
	if (!EMAIL_PREVISTA[kind]) return false;
	const chiave = INTERRUTTORE[kind];
	return chiave === null ? true : preferenze[chiave];
}

/** Esito della consegna, per riga: serve a segnare `emailed_at` solo a chi è partita. */
export type EsitoConsegna = {
	/** Le chiavi sono i `profileId` dei destinatari serviti. */
	riusciti: string[];
	falliti: { profileId: string; motivo: string }[];
};

export const CONSEGNA_VUOTA: EsitoConsegna = { riusciti: [], falliti: [] };

/**
 * Un canale di uscita. Non solleva mai: un canale rotto è un avviso non
 * consegnato, non un salvataggio perso.
 */
export interface NotificationSink {
	readonly nome: string;
	/** `false` quando manca la configurazione: il layer lo salta senza rumore. */
	disponibile(): boolean;
	consegna(avvisi: Avviso[]): Promise<EsitoConsegna>;
}
