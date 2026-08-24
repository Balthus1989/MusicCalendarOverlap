/**
 * Il sink email (ARCHITECTURE.md §10, ADR-0035).
 *
 * Resend via `fetch`, senza SDK: è una POST con un JSON dentro, e una
 * dipendenza in più andrebbe tenuta aggiornata per risparmiare quindici righe.
 * Vale la stessa logica con cui ADR-0034 ha invece **scelto** l'SDK di
 * Anthropic — lì il valore era lo schema forzato, qui non c'è niente di
 * equivalente da guadagnare.
 *
 * Non solleva mai. Un'email non partita è un avviso da ritentare, non un
 * salvataggio perso: `notifications` tiene la riga con `emailed_at` a `NULL` e
 * la corsa notturna ci ripassa (ADR-0036).
 */
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import type { Avviso, EsitoConsegna, NotificationSink } from '../types';

const ENDPOINT = 'https://api.resend.com/emails/batch';

/**
 * Resend accetta cento messaggi per richiesta.
 *
 * Il limite che conta davvero però non è il suo: su Cloudflare Workers ogni
 * `fetch` è una subrequest e il bilancio è finito. Un digest a quaranta
 * iscritti spedito uno alla volta sarebbe quaranta subrequest per un lavoro
 * che ne richiede una.
 */
const PER_RICHIESTA = 100;

/** Venti secondi: oltre, l'avviso si ritenta la notte dopo. */
const TIMEOUT_MS = 20_000;

function baseUrl(): string {
	return (publicEnv.PUBLIC_APP_URL ?? '').replace(/\/+$/, '');
}

/** Percorso interno → indirizzo assoluto. In un'email non esistono link relativi. */
export function assoluto(percorso: string | null): string | null {
	if (!percorso) return null;
	const base = baseUrl();
	return base ? `${base}${percorso}` : null;
}

const escape = (s: string): string =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Il corpo in testo semplice. È la versione **principale**: gli avvisi sono
 * fatti di frasi, non di grafica, e un'email di testo arriva intatta anche
 * dove l'HTML viene rimontato dal client di turno.
 */
export function corpoTesto(avviso: Avviso): string {
	const link = assoluto(avviso.url);
	const coda = [
		'',
		'—',
		link ? `Apri il calendario: ${link}` : null,
		assoluto('/settings/notifications')
			? `Per non ricevere più questi messaggi: ${assoluto('/settings/notifications')}`
			: null
	].filter((r): r is string => r !== null);

	return [avviso.testo, ...coda].join('\n');
}

/** La stessa cosa in HTML, senza fantasia: paragrafi e un link. */
export function corpoHtml(avviso: Avviso): string {
	const paragrafi = avviso.testo
		.split('\n\n')
		.map((p) => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`)
		.join('\n');

	const link = assoluto(avviso.url);
	const impostazioni = assoluto('/settings/notifications');

	return [
		`<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;max-width:34rem">`,
		`<h1 style="font-size:17px;margin:0 0 1rem">${escape(avviso.titolo)}</h1>`,
		paragrafi,
		link ? `<p><a href="${escape(link)}">Apri il calendario</a></p>` : '',
		`<hr style="border:none;border-top:1px solid #ddd;margin:1.5rem 0">`,
		impostazioni
			? `<p style="font-size:13px;color:#666">Puoi scegliere quali email ricevere dalle <a href="${escape(impostazioni)}">impostazioni di notifica</a>.</p>`
			: '',
		`</div>`
	]
		.filter(Boolean)
		.join('\n');
}

type Messaggio = { from: string; to: string[]; subject: string; text: string; html: string };

function messaggioDi(avviso: Avviso, from: string): Messaggio {
	return {
		from,
		to: [avviso.destinatario.email],
		subject: avviso.titolo,
		text: corpoTesto(avviso),
		html: corpoHtml(avviso)
	};
}

function aBlocchi<T>(elementi: T[], dimensione: number): T[][] {
	const blocchi: T[][] = [];
	for (let i = 0; i < elementi.length; i += dimensione) {
		blocchi.push(elementi.slice(i, i + dimensione));
	}
	return blocchi;
}

/**
 * Manda una richiesta a Resend. Restituisce `null` se è andata bene, il motivo
 * se no — mai un'eccezione.
 */
async function spedisci(chiave: string, messaggi: Messaggio[]): Promise<string | null> {
	try {
		const risposta = await fetch(ENDPOINT, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${chiave}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify(messaggi),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});

		if (!risposta.ok) {
			// Il corpo dell'errore di Resend dice quale indirizzo ha rifiutato e
			// perché: senza, resta solo un numero.
			const dettaglio = await risposta.text().catch(() => '');
			return `HTTP ${risposta.status}${dettaglio ? `: ${dettaglio.slice(0, 300)}` : ''}`;
		}

		return null;
	} catch (err) {
		return err instanceof Error ? err.message : 'errore sconosciuto';
	}
}

/**
 * Il sink email vero e proprio.
 *
 * L'esito è per blocco e non per singolo indirizzo: quando la richiesta
 * fallisce, tutti i messaggi che conteneva sono davvero rimasti a terra, e
 * quando riesce Resend li ha accettati tutti. Ciò che accade **dopo**
 * l'accettazione — un rimbalzo, una casella piena — non è visibile da qui e
 * non lo sarebbe nemmeno spedendo uno alla volta.
 */
export class SinkEmail implements NotificationSink {
	readonly nome = 'email';

	disponibile(): boolean {
		return Boolean(env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim());
	}

	async consegna(avvisi: Avviso[]): Promise<EsitoConsegna> {
		const esito: EsitoConsegna = { riusciti: [], falliti: [] };
		if (!avvisi.length) return esito;

		const chiave = env.RESEND_API_KEY?.trim();
		const from = env.EMAIL_FROM?.trim();
		if (!chiave || !from) {
			// Non è un errore da registrare riga per riga: è una macchina non
			// configurata, e lo dice `disponibile()`.
			return { riusciti: [], falliti: [] };
		}

		if (!baseUrl()) {
			// Un'email di avviso senza il link a cui porta è quasi inutile, ma
			// **non** è un motivo per non spedirla: il testo si regge da solo, e
			// tacere per una variabile mancante sarebbe peggio. Va però detto
			// nel registro, perché è una configurazione da sistemare.
			console.warn('PUBLIC_APP_URL non configurata: le email partono senza link.');
		}

		for (const blocco of aBlocchi(avvisi, PER_RICHIESTA)) {
			const motivo = await spedisci(
				chiave,
				blocco.map((a) => messaggioDi(a, from))
			);

			for (const avviso of blocco) {
				if (motivo === null) esito.riusciti.push(avviso.destinatario.profileId);
				else esito.falliti.push({ profileId: avviso.destinatario.profileId, motivo });
			}
		}

		return esito;
	}

	/**
	 * Un'email fuori dal layer: l'invito, che va a un indirizzo senza profilo
	 * dietro e non ha quindi nessuna riga in `notifications` (§10, riga 3).
	 */
	async inviaDiretta(a: string, oggetto: string, testo: string): Promise<string | null> {
		const chiave = env.RESEND_API_KEY?.trim();
		const from = env.EMAIL_FROM?.trim();
		if (!chiave || !from) return 'Invio email non configurato (RESEND_API_KEY / EMAIL_FROM).';

		return spedisci(chiave, [
			{
				from,
				to: [a],
				subject: oggetto,
				text: testo,
				html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;max-width:34rem">${testo
					.split('\n\n')
					.map((p) => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`)
					.join('\n')}</div>`
			}
		]);
	}
}

export const sinkEmail = new SinkEmail();
