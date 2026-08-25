/**
 * Il canale Telegram (ARCHITECTURE.md §10, ADR-0039).
 *
 * Chiude la decisione aperta #6 del registro, e la chiude per una ragione che
 * quando era stata scritta non c'era: **è gratuito**. Mandare email a
 * destinatari qualsiasi richiede un dominio verificato, e finché il dominio
 * non c'è le notifiche non uscivano dall'applicazione. Un bot Telegram non
 * chiede domini, non chiede record DNS, e la community degli organizzatori
 * quel canale ce l'ha già aperto sul telefono.
 *
 * Due cose che non fa, e che è meglio sapere subito.
 *
 * **Non raggiunge chi non si è collegato.** Un bot non può scrivere per primo:
 * è Telegram a proibirlo, ed è il motivo per cui esiste tutto il giro di
 * `avviaCollegamento` qui sotto. Un profilo senza chat collegata riceve gli
 * avvisi solo in pagina, che è la condizione predefinita di chiunque.
 *
 * **Non raggiunge chi non è ancora iscritto.** L'invito resta un link da
 * passare a mano: chi lo riceve non ha un profilo, quindi non ha una chat
 * collegata, e non c'è nessun modo di dargliene una prima che entri.
 */
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Database } from '$lib/server/db/client';
import { notificationPrefs } from '$lib/server/db/schema';
import type { Avviso, EsitoConsegna, NotificationSink } from '../types';

const API = 'https://api.telegram.org';

/** Venti secondi: oltre, l'avviso si ritenta la notte dopo. */
const TIMEOUT_MS = 20_000;

/**
 * Il limite di Telegram per messaggio è 4096 caratteri.
 *
 * Si taglia più corto per lasciare spazio al titolo e al link, che si
 * aggiungono dopo. Un digest con quaranta voci ci arriva davvero, e un
 * messaggio rifiutato per lunghezza sarebbe un avviso perso per un motivo che
 * non ha niente a che fare con il suo contenuto.
 */
const MAX_TESTO = 3500;

function token(): string | null {
	return env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

/** Lo username del bot, per costruire il link di collegamento. */
export function nomeBot(): string | null {
	return env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '') || null;
}

function baseUrl(): string {
	return (publicEnv.PUBLIC_APP_URL ?? '').replace(/\/+$/, '');
}

/* ------------------------------------------------------------------ *
 * Il testo
 * ------------------------------------------------------------------ */

/**
 * Il messaggio come arriva su Telegram.
 *
 * **Testo semplice, senza Markdown né HTML.** Gli avvisi contengono nomi di
 * band e titoli di serate scritti dagli utenti, e in Markdown un underscore o
 * un asterisco in un nome fa fallire l'intero messaggio con un errore di
 * parsing. Il grassetto non vale quel rischio.
 */
export function corpoTelegram(avviso: Avviso, base = baseUrl()): string {
	const testo =
		avviso.testo.length > MAX_TESTO ? `${avviso.testo.slice(0, MAX_TESTO)}\n[…]` : avviso.testo;

	const link = base && avviso.url ? `${base}${avviso.url}` : null;

	return [avviso.titolo, '', testo, ...(link ? ['', link] : [])].join('\n');
}

/* ------------------------------------------------------------------ *
 * Il collegamento di una chat a un profilo
 * ------------------------------------------------------------------ */

/** Quanto vale un codice di collegamento prima di scadere. */
export const MINUTI_VALIDITA_TOKEN = 30;

/**
 * Il codice usa-e-getta.
 *
 * Maiuscole e cifre, senza le lettere che si confondono a leggerle da uno
 * schermo e a riscriverle su un telefono: niente `O`, `0`, `I`, `1`.
 */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generaToken(lunghezza = 8): string {
	const byte = crypto.getRandomValues(new Uint8Array(lunghezza));
	return Array.from(byte, (b) => ALFABETO[b % ALFABETO.length]).join('');
}

/** Vero se il codice è ancora spendibile. */
export function tokenValido(emessoIl: Date | null, adesso = new Date()): boolean {
	if (!emessoIl) return false;
	return adesso.getTime() - emessoIl.getTime() < MINUTI_VALIDITA_TOKEN * 60_000;
}

/**
 * Il link che apre il bot con il codice già dentro.
 *
 * `?start=` è la sola cosa che Telegram passa a un bot prima che la
 * conversazione esista: chi tocca il link vede il pulsante «Avvia», e quel
 * pulsante manda `/start CODICE`. Senza, il codice andrebbe copiato a mano da
 * uno schermo a un altro.
 */
export function linkCollegamento(codice: string, bot = nomeBot()): string | null {
	return bot ? `https://t.me/${bot}?start=${codice}` : null;
}

type Aggiornamento = {
	message?: { chat?: { id?: number }; text?: string };
};

/**
 * Cerca il codice fra i messaggi ricevuti dal bot e restituisce la chat che
 * l'ha mandato.
 *
 * Funzione pura: prende la risposta di `getUpdates` già decodificata. È qui
 * che si testa il caso che conta — un codice che compare dentro un messaggio
 * di qualcun altro non deve collegare la chat sbagliata.
 */
export function chatDalCodice(aggiornamenti: unknown, codice: string): string | null {
	if (!Array.isArray(aggiornamenti) || !codice) return null;

	const atteso = codice.trim().toUpperCase();

	for (const grezzo of aggiornamenti as Aggiornamento[]) {
		const testo = grezzo?.message?.text;
		const chat = grezzo?.message?.chat?.id;
		if (typeof testo !== 'string' || typeof chat !== 'number') continue;

		// Il codice deve essere una **parola intera** del messaggio: `/start
		// ABC12345` va bene, e un codice che capita dentro una parola più
		// lunga no. Senza questo, due codici che condividono un prefisso si
		// confonderebbero.
		const parole = testo.toUpperCase().split(/[^A-Z0-9]+/);
		if (parole.includes(atteso)) return String(chat);
	}

	return null;
}

/**
 * Chiama l'API del bot. Restituisce il corpo decodificato, oppure `null` con
 * il motivo: non solleva mai.
 */
async function chiama(
	metodo: string,
	corpo?: Record<string, unknown>
): Promise<{ ok: true; risultato: unknown } | { ok: false; motivo: string }> {
	const t = token();
	if (!t) return { ok: false, motivo: 'TELEGRAM_BOT_TOKEN non configurata.' };

	try {
		const risposta = await fetch(`${API}/bot${t}/${metodo}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(corpo ?? {}),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});

		const dati = (await risposta.json().catch(() => null)) as {
			ok?: boolean;
			result?: unknown;
			description?: string;
		} | null;

		if (!risposta.ok || !dati?.ok) {
			// La `description` di Telegram è quasi sempre leggibile — "chat not
			// found", "bot was blocked by the user" — ed è esattamente ciò che
			// serve in `errore_consegna` per capire di chi è il problema.
			return {
				ok: false,
				motivo: dati?.description ?? `HTTP ${risposta.status}`
			};
		}

		return { ok: true, risultato: dati.result };
	} catch (err) {
		return { ok: false, motivo: err instanceof Error ? err.message : 'errore sconosciuto' };
	}
}

/**
 * Apre un collegamento: genera il codice, lo salva sul profilo e restituisce
 * ciò che serve a mostrarlo.
 */
export async function avviaCollegamento(
	db: Database,
	profileId: string
): Promise<{ codice: string; link: string | null }> {
	const codice = generaToken();

	await db
		.insert(notificationPrefs)
		.values({ profileId, telegramToken: codice, telegramTokenAt: new Date() })
		.onConflictDoUpdate({
			target: notificationPrefs.profileId,
			set: { telegramToken: codice, telegramTokenAt: new Date(), updatedAt: new Date() }
		});

	return { codice, link: linkCollegamento(codice) };
}

export type EsitoCollegamento = { ok: true; chatId: string } | { ok: false; motivo: string };

/**
 * Completa il collegamento cercando il codice fra i messaggi ricevuti.
 *
 * **Non c'è nessun webhook**, ed è deliberato: un webhook vuole un indirizzo
 * pubblico che Telegram possa raggiungere, e fino al deploy non esiste.
 * `getUpdates` è una POST come le altre e funziona anche da `localhost`, il
 * che rende questo giro provabile prima di mettere l'applicazione online
 * (ADR-0040).
 *
 * Gli aggiornamenti **non si consumano** — nessun `offset` — perché due
 * profili che si collegano nello stesso minuto si ruberebbero i messaggi a
 * vicenda. Telegram li lascia cadere da solo dopo un giorno.
 */
export async function completaCollegamento(
	db: Database,
	profileId: string
): Promise<EsitoCollegamento> {
	const [riga] = await db
		.select({
			token: notificationPrefs.telegramToken,
			emessoIl: notificationPrefs.telegramTokenAt
		})
		.from(notificationPrefs)
		.where(eq(notificationPrefs.profileId, profileId));

	if (!riga?.token) return { ok: false, motivo: 'Nessun collegamento in corso: ricomincia.' };
	if (!tokenValido(riga.emessoIl)) {
		return { ok: false, motivo: 'Il codice è scaduto: generane uno nuovo.' };
	}

	const esito = await chiama('getUpdates', { limit: 100, timeout: 0 });
	if (!esito.ok) return { ok: false, motivo: esito.motivo };

	const chatId = chatDalCodice(esito.risultato, riga.token);
	if (!chatId) {
		return {
			ok: false,
			motivo: 'Il messaggio non è ancora arrivato. Mandalo al bot e riprova fra qualche secondo.'
		};
	}

	await db
		.update(notificationPrefs)
		.set({
			telegramChatId: chatId,
			// Il codice ha esaurito il suo scopo: tenerlo sarebbe tenere in giro
			// una chiave che apre una notifica altrui.
			telegramToken: null,
			telegramTokenAt: null,
			updatedAt: new Date()
		})
		.where(eq(notificationPrefs.profileId, profileId));

	return { ok: true, chatId };
}

/** Stacca la chat: gli avvisi tornano a leggersi solo in pagina. */
export async function scollega(db: Database, profileId: string): Promise<void> {
	await db
		.update(notificationPrefs)
		.set({
			telegramChatId: null,
			telegramToken: null,
			telegramTokenAt: null,
			updatedAt: new Date()
		})
		.where(eq(notificationPrefs.profileId, profileId));
}

/** La chat collegata di un profilo, per la pagina delle impostazioni. */
export async function chatCollegata(db: Database, profileId: string): Promise<string | null> {
	const [riga] = await db
		.select({ chatId: notificationPrefs.telegramChatId })
		.from(notificationPrefs)
		.where(eq(notificationPrefs.profileId, profileId));
	return riga?.chatId ?? null;
}

/* ------------------------------------------------------------------ *
 * Il sink
 * ------------------------------------------------------------------ */

export class SinkTelegram implements NotificationSink {
	readonly nome = 'telegram';

	disponibile(): boolean {
		return token() !== null;
	}

	/**
	 * Un messaggio per destinatario, uno alla volta.
	 *
	 * Telegram non ha un invio massivo: `sendMessage` prende una chat sola. A
	 * differenza dell'email questo non è un problema di subrequest — gli avvisi
	 * di conflitto sono due o tre per volta — ma il digest settimanale a venti
	 * iscritti sono venti chiamate, ed è il motivo per cui il digest gira in un
	 * job suo e non dentro una richiesta di qualcuno.
	 */
	async consegna(db: Database, avvisi: Avviso[]): Promise<EsitoConsegna> {
		const esito: EsitoConsegna = { riusciti: [], falliti: [] };
		if (!avvisi.length || !this.disponibile()) return esito;

		const profileIds = [...new Set(avvisi.map((a) => a.destinatario.profileId))];

		const righe = await db
			.select({
				profileId: notificationPrefs.profileId,
				chatId: notificationPrefs.telegramChatId
			})
			.from(notificationPrefs)
			.where(
				and(
					inArray(notificationPrefs.profileId, profileIds),
					isNotNull(notificationPrefs.telegramChatId)
				)
			);

		const chatPerProfilo = new Map(righe.map((r) => [r.profileId, r.chatId as string]));

		for (const avviso of avvisi) {
			const chatId = chatPerProfilo.get(avviso.destinatario.profileId);

			if (!chatId) {
				/**
				 * Non collegato: **non è un errore**, ed è importante che non lo
				 * diventi. Segnarlo fra i falliti riempirebbe `errore_consegna` e
				 * farebbe ritentare ogni notte per tre giorni una consegna che non
				 * può riuscire. Chi non ha collegato la chat legge gli avvisi in
				 * pagina, che è la condizione predefinita.
				 */
				continue;
			}

			const risposta = await chiama('sendMessage', {
				chat_id: chatId,
				text: corpoTelegram(avviso),
				disable_web_page_preview: true
			});

			if (risposta.ok) esito.riusciti.push(avviso.destinatario.profileId);
			else
				esito.falliti.push({ profileId: avviso.destinatario.profileId, motivo: risposta.motivo });
		}

		return esito;
	}
}

export const sinkTelegram = new SinkTelegram();
