/**
 * L'import assistito, da un capo all'altro (ARCHITECTURE.md §9, Fase 5).
 *
 * Riconosce che cos'è l'incollato, lo legge con la strada giusta, lo traduce
 * in valori di form, cerca le band in anagrafica e registra il tentativo. È il
 * solo posto che mette insieme le parti pure di questa cartella con il
 * database: `ics.ts`, `csv.ts`, `sniff.ts`, `to-form.ts` e `prompt.ts`
 * continuano a non sapere che esiste una connessione, ed è ciò che li rende
 * provabili caso per caso.
 *
 * **Non crea mai un evento.** Il risultato è un form pre-compilato che una
 * persona rivede e salva — o non salva. È il punto 3 di §9 e non ammette
 * scorciatoie: nemmeno un `.ics` nostro, che pure conterrebbe dati puliti,
 * diventa una data senza che qualcuno l'abbia guardata (ADR-0031).
 */
import { and, count, eq, gte } from 'drizzle-orm';
import type { ValoriEvento } from '$lib/events';
import type { EsitoImport, Sorgente } from '$lib/parse';
import type { BersaglioParse } from '$lib/schemas/parse';
import type { Database } from '$lib/server/db/client';
import { parseJobs, type ParseSource } from '$lib/server/db/schema';
import { giornoCivile } from '$lib/time';
import { leggiCsv } from './csv';
import { leggiIcs } from './ics';
import { struttura, TESTO_MASSIMO } from './llm';
import { proponiArtisti } from './match';
import { riconosciSorgente } from './sniff';
import { versoIlForm, type ContestoForm } from './to-form';

/** La forma della risposta vive in `$lib/parse.ts`: la legge anche il browser. */
export type { EsitoImport };

/* ------------------------------------------------------------------ *
 * Limite d'uso
 * ------------------------------------------------------------------ */

/**
 * Quanti riconoscimenti a modello può chiedere un profilo in un'ora.
 *
 * §16 lo elenca fra i rate limit necessari, e qui è più stringente che
 * altrove per una ragione che gli altri endpoint non hanno: **questa chiamata
 * costa denaro**. Venti all'ora è largo per chi compila form a mano e stretto
 * per un ciclo impazzito, che è esattamente la distinzione che serve.
 *
 * Il conteggio si legge da `parse_jobs`, con l'indice `(profile_id,
 * created_at)` che esiste per questo. Nessun contatore in memoria: su
 * Cloudflare gli isolate vanno e vengono, e un limite che si azzera a ogni
 * risveglio non è un limite (ADR-0013 — niente Redis, niente servizi in più).
 */
export const TETTO_ORARIO = 20;

/** Le sorgenti deterministiche non costano niente e non entrano nel conteggio. */
async function riconoscimentiUltimaOra(db: Database, profileId: string): Promise<number> {
	const unOraFa = new Date(Date.now() - 60 * 60 * 1000);
	const r = await db
		.select({ n: count() })
		.from(parseJobs)
		.where(
			and(
				eq(parseJobs.profileId, profileId),
				eq(parseJobs.source, 'testo'),
				gte(parseJobs.createdAt, unOraFa)
			)
		);
	return r[0]?.n ?? 0;
}

/* ------------------------------------------------------------------ *
 * Il registro
 * ------------------------------------------------------------------ */

/**
 * Registra il tentativo, riuscito o no.
 *
 * §9 punto 5: «Il job resta in `parse_jobs` per debug e per misurare la
 * qualità dell'estrazione». Vale per tutte e tre le sorgenti — un `.ics` letto
 * male è un difetto del nostro codice, e senza il file di partenza non si
 * riproduce.
 *
 * **Non solleva.** Un registro che rompe l'operazione che stava registrando
 * sarebbe il peggiore dei due mondi, ed è la stessa scelta di `audit.ts` e
 * della riconciliazione dei conflitti.
 */
async function registra(
	db: Database,
	profileId: string,
	rawText: string,
	source: ParseSource,
	esito: { bersaglio: BersaglioParse | null; modello: string | null; errore: string | null }
) {
	try {
		await db.insert(parseJobs).values({
			profileId,
			rawText,
			source,
			parsedJson: esito.bersaglio,
			model: esito.modello,
			status: esito.errore ? 'errore' : esito.bersaglio ? 'ok' : 'vuoto',
			error: esito.errore
		});
	} catch (e) {
		console.error('parse_jobs: registrazione fallita', e);
	}
}

/* ------------------------------------------------------------------ *
 * L'operazione
 * ------------------------------------------------------------------ */

function fallimento(sorgente: Sorgente, base: ValoriEvento, errore: string): EsitoImport {
	// Il form torna **identico** a com'era: chi ha incollato un testo e ha
	// ricevuto un errore non deve anche ritrovarsi i campi svuotati.
	return { sorgente, valori: base, compilati: [], avvisi: [], proposte: [], errore };
}

export async function importaDaTesto(
	db: Database,
	profileId: string,
	testo: string,
	ctx: ContestoForm,
	adesso: Date = new Date()
): Promise<EsitoImport> {
	const grezzo = testo.trim();
	const sorgente = riconosciSorgente(grezzo);

	if (grezzo.length < 10) {
		return fallimento(sorgente, ctx.base, 'Il testo è troppo corto per contenere una data.');
	}
	if (grezzo.length > TESTO_MASSIMO) {
		return fallimento(
			sorgente,
			ctx.base,
			`Il testo è troppo lungo (${grezzo.length} caratteri, il massimo è ${TESTO_MASSIMO}). Incolla il solo annuncio.`
		);
	}

	let bersaglio: BersaglioParse;
	let modello: string | null = null;
	const avvisiSorgente: string[] = [];

	if (sorgente === 'ics') {
		const esito = leggiIcs(grezzo);
		bersaglio = esito.bersaglio;
		if (esito.totaleEventi > 1)
			avvisiSorgente.push(quantiNeSonoRimasti(esito.totaleEventi, 'date'));
	} else if (sorgente === 'csv') {
		const esito = leggiCsv(grezzo);
		bersaglio = esito.bersaglio;
		if (esito.totaleRighe > 1) avvisiSorgente.push(quantiNeSonoRimasti(esito.totaleRighe, 'righe'));
	} else {
		const quanti = await riconoscimentiUltimaOra(db, profileId);
		if (quanti >= TETTO_ORARIO) {
			return fallimento(
				sorgente,
				ctx.base,
				`Hai già chiesto ${quanti} riconoscimenti nell’ultima ora, che è il massimo. Riprova più tardi, oppure compila il form a mano.`
			);
		}

		const esito = await struttura(grezzo, giornoCivile(adesso), ctx.generi);
		modello = esito.modello;

		if (!esito.ok) {
			await registra(db, profileId, grezzo, 'testo', {
				bersaglio: null,
				modello,
				errore: esito.errore
			});
			return fallimento(sorgente, ctx.base, esito.errore);
		}
		bersaglio = esito.bersaglio;
	}

	await registra(db, profileId, grezzo, sorgente, { bersaglio, modello, errore: null });

	const mappato = versoIlForm(bersaglio, ctx);
	const proposte = await proponiArtisti(db, mappato.valori.lineup);

	// Nessun campo riempito e nessun avviso è il caso peggiore da presentare:
	// un pannello che si chiude e un form identico a prima si legge come un
	// pulsante rotto. Meglio dirlo.
	if (!mappato.compilati.length && !mappato.avvisi.length) {
		return fallimento(
			sorgente,
			ctx.base,
			'Non si è riconosciuto nessun dato di evento in quel testo.'
		);
	}

	return {
		sorgente,
		valori: mappato.valori,
		compilati: mappato.compilati,
		avvisi: [...avvisiSorgente, ...mappato.avvisi],
		proposte,
		errore: null
	};
}

/**
 * Un file con dieci date di cui ne compare una, senza spiegazione, si legge
 * come un parser rotto. Vedi ADR-0033.
 */
function quantiNeSonoRimasti(totale: number, unita: string): string {
	return `Il file conteneva ${totale} ${unita}: qui c’è solo la prima. Le altre si aggiungono una alla volta, oppure ripetendo l’incolla dopo aver salvato questa.`;
}
