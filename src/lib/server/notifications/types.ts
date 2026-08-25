/**
 * Il contratto del layer di notifica (ARCHITECTURE.md §10, ADR-0035).
 *
 * `NotificationSink` esiste perché la specifica lo chiede per nome, e in Fase 6
 * ha già ripagato: il canale è passato dall'email a Telegram cambiando i file
 * dentro `sinks/` e nient'altro ([ADR-0039](../../../../docs/DECISIONS.md)). Il
 * resto del codice non sa quali sink esistano: costruisce avvisi e li consegna.
 *
 * Il file è codice puro: nessuna query, nessun `fetch`. Le tabelle di
 * decisione — quale avviso esce dall'applicazione, quale interruttore lo
 * governa — si
 * leggono qui e si testano senza database.
 */
import type { NotificationKind } from '$lib/server/db/schema';

/**
 * Chi riceve.
 *
 * L'email c'è sempre — è il campo su cui si fa il login — anche ora che non
 * serve più a consegnare: resta l'unico modo di dire *chi* è un destinatario
 * quando si legge un registro o si diagnostica una consegna mancata.
 */
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
 * momento giusto è l'unico modo perché la copia consegnata e la riga in
 * pagina raccontino la stessa cosa.
 */
export type Avviso = {
	kind: NotificationKind;
	destinatario: Destinatario;
	titolo: string;
	testo: string;
	/** Percorso interno, senza dominio: chi consegna ci mette davanti `PUBLIC_APP_URL`. */
	url: string | null;
	/**
	 * Identità dell'avviso, per non ripeterlo. `null` per ciò che nasce da un
	 * fatto puntuale — un conflitto rilevato adesso — e non da una scansione
	 * che ripasserà domani sulle stesse righe.
	 */
	dedupeKey: string | null;
};

/**
 * Quali avvisi prevedono una copia **fuori dall'applicazione** (§10).
 *
 * La riga in `notifications` viene scritta **sempre**, anche per ciò che §10
 * manda solo sul canale esterno: quella tabella è anche la coda di uscita
 * (ADR-0036), e nascondere in pagina un avviso già consegnato significherebbe
 * costruire un filtro il cui unico effetto è far dimenticare
 * all'applicazione di aver scritto a qualcuno.
 *
 * `invito` resta `true` e resta **inerte**: un invito non ha una `profile_id`
 * a cui appartenere, quindi non produce nessuna riga e non arriva mai qui. Il
 * valore è tenuto perché la tabella copra l'enum per intero.
 */
export const CONSEGNA_PREVISTA: Record<NotificationKind, boolean> = {
	conflitto_nuovo: true,
	conflitto_risolto: false,
	invito: true,
	digest_settimanale: true,
	sollecito_annuncio: true
};

/** Gli interruttori di `notification_prefs`, uno per famiglia di avvisi. */
export type Preferenze = {
	avvisaConflitti: boolean;
	avvisaDigest: boolean;
	avvisaSolleciti: boolean;
};

/** Nessuna riga in tabella vale "tutto acceso": il silenzio non si eredita da una dimenticanza. */
export const PREFERENZE_PREDEFINITE: Preferenze = {
	avvisaConflitti: true,
	avvisaDigest: true,
	avvisaSolleciti: true
};

/**
 * Quale interruttore governa quale avviso. `null` significa "non
 * disattivabile": l'invito arriva a chi non ha ancora un profilo su cui
 * esprimere una preferenza, e il conflitto risolto non esce comunque
 * dall'applicazione.
 */
const INTERRUTTORE: Record<NotificationKind, keyof Preferenze | null> = {
	conflitto_nuovo: 'avvisaConflitti',
	conflitto_risolto: null,
	invito: null,
	digest_settimanale: 'avvisaDigest',
	sollecito_annuncio: 'avvisaSolleciti'
};

/** Se questo avviso, con queste preferenze, va consegnato fuori dall'applicazione. */
export function vuoleConsegna(kind: NotificationKind, preferenze: Preferenze): boolean {
	if (!CONSEGNA_PREVISTA[kind]) return false;
	const chiave = INTERRUTTORE[kind];
	return chiave === null ? true : preferenze[chiave];
}

/** Esito della consegna, per riga: serve a segnare `consegnata_at` solo a chi è riuscita. */
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
