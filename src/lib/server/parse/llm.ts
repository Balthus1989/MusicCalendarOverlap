/**
 * La chiamata al modello (ARCHITECTURE.md §9, ADR-0034).
 *
 * L'unico pezzo dell'import assistito con dell'I/O, e l'unico costo variabile
 * del progetto. Tutto ciò che si può decidere senza rete sta altrove — nel
 * prompt, nello schema, nella mappatura al form — così che qui resti soltanto
 * il traffico.
 *
 * **Lo schema è forzato dall'API, non chiesto per favore.** `output_config.format`
 * vincola la risposta a `bersaglioParse`: non c'è nessun JSON da estrarre da
 * un blocco di testo, nessuna virgola in più da perdonare, nessun ciclo di
 * riprova quando il parsing fallisce. È la differenza fra un'integrazione che
 * regge e una che regge quasi sempre.
 *
 * **Non solleva mai.** È la stessa disciplina della riconciliazione dei
 * conflitti e del registro di audit: chi ha appena incollato un post non deve
 * vedere una schermata d'errore perché un servizio esterno non risponde. Il
 * fallimento torna come esito, l'inserimento manuale resta intatto — è il
 * principio 5 di §2, e per il parser è scritto a chiare lettere anche in §9.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { env } from '$env/dynamic/private';
import { bersaglioParse, type BersaglioParse } from '$lib/schemas/parse';
import { domanda, sistema } from './prompt';
import type { GenereNoto } from './to-form';

/**
 * Il modello predefinito.
 *
 * ARCHITECTURE.md §9 prescrive «un modello economico (classe Haiku/Flash)» e
 * stima l'ordine di grandezza in 1-2 € l'anno. Resta sovrascrivibile con
 * `LLM_MODEL` senza toccare il codice: l'estrazione da un post scritto male è
 * il caso in cui un modello più capace si sente, e il giorno in cui servisse
 * è una variabile d'ambiente, non un rilascio.
 */
export const MODELLO_PREDEFINITO = 'claude-haiku-4-5';

/** §9: «timeout 20 s». Chi sta compilando un form non aspetta di più. */
const TIMEOUT_MS = 20_000;

/**
 * Il tetto di caratteri che si manda al modello.
 *
 * Un post di concerto sta in duemila caratteri. Oltre i ventimila non c'è un
 * annuncio, c'è un incolla andato storto — la pagina intera di un sito, la
 * cronologia di una chat — e mandarlo costa senza produrre niente. Il testo
 * **non si tronca in silenzio**: si rifiuta, e lo si dice.
 */
export const TESTO_MASSIMO = 20_000;

export type EsitoLlm =
	| { ok: true; bersaglio: BersaglioParse; modello: string }
	| { ok: false; errore: string; modello: string | null };

let cliente: Anthropic | null = null;

function client(chiave: string): Anthropic {
	// Un client per isolate: costruirlo a ogni richiesta rifà il pool di
	// connessioni sottostante per una chiamata sola.
	if (!cliente) cliente = new Anthropic({ apiKey: chiave, maxRetries: 1 });
	return cliente;
}

/** Vero se il paste-to-parse è configurato. Senza chiave la funzione resta spenta. */
export function llmConfigurato(): boolean {
	return Boolean(env.LLM_API_KEY?.trim());
}

/**
 * Struttura il testo incollato.
 *
 * `oggi` arriva dal chiamante e non da `new Date()` qui dentro: è il giorno
 * civile italiano, e serve al modello per dedurre l'anno che negli annunci non
 * è quasi mai scritto. Passarlo rende la funzione provabile con una data
 * fissa, che è l'unico modo di scrivere un test su «sabato 12 ottobre».
 */
export async function struttura(
	testo: string,
	oggi: string,
	generi: GenereNoto[]
): Promise<EsitoLlm> {
	const chiave = env.LLM_API_KEY?.trim();
	const modello = env.LLM_MODEL?.trim() || MODELLO_PREDEFINITO;

	if (!chiave) {
		return {
			ok: false,
			modello: null,
			errore:
				'Il riconoscimento automatico del testo non è configurato su questo server (manca LLM_API_KEY).'
		};
	}

	if (testo.length > TESTO_MASSIMO) {
		return {
			ok: false,
			modello,
			errore: `Il testo è troppo lungo (${testo.length} caratteri, il massimo è ${TESTO_MASSIMO}). Incolla il solo annuncio.`
		};
	}

	try {
		const risposta = await client(chiave).messages.parse(
			{
				model: modello,
				max_tokens: 8000,
				system: sistema(generi),
				messages: [{ role: 'user', content: domanda(testo, oggi) }],
				output_config: { format: zodOutputFormat(bersaglioParse) }
			},
			{ timeout: TIMEOUT_MS }
		);

		const estratto = risposta.parsed_output;
		if (!estratto) {
			return { ok: false, modello, errore: 'Il modello non ha restituito dati leggibili.' };
		}

		// Si rivalida comunque, e non è diffidenza verso l'API: `parsed_output`
		// è tipizzato ma il contenuto arriva dalla rete, e da qui in poi il
		// bersaglio entra in un form. Costa una `safeParse` su un oggetto
		// piccolo.
		const controllato = bersaglioParse.safeParse(estratto);
		if (!controllato.success) {
			return { ok: false, modello, errore: 'La risposta del modello non rispetta lo schema.' };
		}

		return { ok: true, bersaglio: controllato.data, modello };
	} catch (e) {
		return { ok: false, modello, errore: messaggio(e) };
	}
}

/**
 * L'errore in una frase che un organizzatore possa leggere.
 *
 * Il dettaglio tecnico va nel registro `parse_jobs`, non a schermo: chi ha
 * incollato un post deve sapere se riprovare o scrivere a mano, non quale
 * codice HTTP è tornato.
 */
function messaggio(e: unknown): string {
	if (e instanceof Anthropic.APIUserAbortError || (e instanceof Error && e.name === 'AbortError')) {
		return `Il riconoscimento ha superato i ${TIMEOUT_MS / 1000} secondi. Il form è rimasto come l’avevi lasciato: puoi riprovare o compilarlo a mano.`;
	}
	if (e instanceof Anthropic.AuthenticationError) {
		return 'La chiave del servizio di riconoscimento non è valida. Segnalalo a chi gestisce il calendario.';
	}
	if (e instanceof Anthropic.RateLimitError) {
		return 'Il servizio di riconoscimento è momentaneamente sovraccarico. Riprova fra un minuto.';
	}
	if (e instanceof Anthropic.APIConnectionError) {
		return 'Non è stato possibile raggiungere il servizio di riconoscimento. Puoi compilare il form a mano.';
	}
	if (e instanceof Anthropic.APIError) {
		return `Il servizio di riconoscimento ha risposto con un errore (${e.status ?? 'senza codice'}).`;
	}
	return 'Il riconoscimento automatico non è riuscito. Puoi compilare il form a mano.';
}
