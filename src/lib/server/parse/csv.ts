/**
 * Lettura deterministica di un CSV (ARCHITECTURE.md §9).
 *
 * L'altra metà del «parsing deterministico, nessun LLM coinvolto», insieme a
 * `ics.ts`. Il caso a cui serve davvero non è un CSV qualunque trovato in
 * rete: è **il nostro export** (`export/csv.ts`), che così torna dentro da
 * dove è uscito. Le intestazioni riconosciute partono da quelle, e le altre
 * sono alias di cortesia per chi arriva da un foglio di calcolo suo.
 *
 * Codice puro, come `ics.ts`. Nessun I/O, nessuna dipendenza.
 */
import { bersaglioVuoto, type BersaglioParse, type VoceLineupParse } from '$lib/schemas/parse';
import { BOM_UTF8 } from '$lib/server/export/csv';
import { normalizeName } from '$lib/server/text';

export type EsitoCsv = {
	bersaglio: BersaglioParse;
	/** Quante righe di dati conteneva il file: se ne usa una sola (ADR-0033). */
	totaleRighe: number;
};

/** I separatori che si incontrano davvero. Il punto e virgola è Excel in italiano. */
const SEPARATORI = [',', ';', '\t'] as const;

/* ------------------------------------------------------------------ *
 * Tokenizzazione
 * ------------------------------------------------------------------ */

/**
 * Divide un CSV in righe di celle, secondo RFC 4180.
 *
 * Non si può fare con `split('\n')` e poi `split(',')`: una cella fra
 * virgolette può contenere sia il separatore sia un a-capo, ed è il caso
 * normale non appena c'è una `descrizione` o una `lineup` dentro. Serve
 * leggere carattere per carattere sapendo se si è dentro o fuori dagli apici.
 */
export function dividiCsv(testo: string, separatore: string): string[][] {
	// Il BOM che il nostro export scrive apposta per Excel: qui è rumore, e
	// lasciarlo renderebbe la prima intestazione irriconoscibile.
	const s = testo.startsWith(BOM_UTF8) ? testo.slice(BOM_UTF8.length) : testo;
	const righe: string[][] = [];
	let riga: string[] = [];
	let cella = '';
	let fraApici = false;

	for (let i = 0; i < s.length; i++) {
		const c = s[i];

		if (fraApici) {
			if (c === '"') {
				// Due virgolette di fila dentro una cella quotata sono una
				// virgoletta vera, non la fine della cella.
				if (s[i + 1] === '"') {
					cella += '"';
					i++;
				} else fraApici = false;
			} else cella += c;
			continue;
		}

		if (c === '"') fraApici = true;
		else if (c === separatore) {
			riga.push(cella);
			cella = '';
		} else if (c === '\n' || c === '\r') {
			// Un CRLF è una fine riga sola, non due.
			if (c === '\r' && s[i + 1] === '\n') i++;
			riga.push(cella);
			righe.push(riga);
			riga = [];
			cella = '';
		} else cella += c;
	}

	if (cella !== '' || riga.length) {
		riga.push(cella);
		righe.push(riga);
	}

	// Una riga di soli campi vuoti è la riga in fondo al file, non un dato.
	return righe.filter((r) => r.some((v) => v.trim() !== ''));
}

/* ------------------------------------------------------------------ *
 * Intestazioni
 * ------------------------------------------------------------------ */

/**
 * `Prezzo Prevendita (€)`, `prezzo_prevendita` e `Prezzo prevendita` sono la
 * stessa colonna. È `normalizeName()` — quella della deduplica artisti — più
 * gli spazi ricondotti a underscore, così la tabella qui sotto si legge come
 * le intestazioni che scrive il nostro export.
 */
export function normalizzaIntestazione(v: string): string {
	return normalizeName(v).replace(/ /g, '_');
}

/**
 * Da nome di colonna a campo del bersaglio.
 *
 * La prima voce di ogni riga è l'intestazione che scrive il nostro export: è
 * quella che deve funzionare sempre. Le altre sono alias, e costano una riga
 * di tabella ciascuna.
 */
const COLONNE: Record<string, string[]> = {
	giorno: ['giorno', 'data', 'date', 'giorno_evento'],
	oraInizio: ['ora_inizio', 'ora', 'orario', 'inizio', 'time', 'start_time'],
	oraFine: ['ora_fine', 'fine', 'end_time'],
	inizioCompleto: ['inizio_completo', 'starts_at', 'datetime', 'data_ora'],
	title: ['titolo', 'title', 'nome', 'evento'],
	subtitle: ['sottotitolo', 'subtitle'],
	description: ['descrizione', 'description', 'note', 'testo'],
	venueName: ['locale', 'venue', 'luogo', 'sede'],
	address: ['indirizzo', 'address', 'via'],
	city: ['citta', 'city', 'comune'],
	province: ['provincia', 'province', 'prov', 'sigla'],
	genres: ['generi', 'genere_principale', 'genere', 'genres', 'genre', 'categorie'],
	lineup: ['lineup', 'band', 'artisti', 'artists', 'line_up'],
	isFree: ['ingresso_libero', 'gratuito', 'free', 'ingresso_gratuito'],
	pricePresale: ['prezzo_prevendita', 'prevendita', 'presale', 'prezzo'],
	priceDoor: ['prezzo_porta', 'porta', 'door', 'prezzo_cassa'],
	ticketUrl: ['ticket_url', 'biglietti', 'tickets', 'prevendita_url'],
	ageRestriction: ['eta', 'age', 'eta_minima'],
	externalUrl: ['url', 'link', 'sito', 'evento_url']
};

const PER_INTESTAZIONE = new Map<string, string>();
for (const [campo, nomi] of Object.entries(COLONNE)) {
	for (const n of nomi) if (!PER_INTESTAZIONE.has(n)) PER_INTESTAZIONE.set(n, campo);
}

/** Quante intestazioni di una riga si riconoscono. Serve anche a `sniff.ts`. */
export function intestazioniRiconosciute(celle: string[]): number {
	const viste = new Set<string>();
	for (const c of celle) {
		const campo = PER_INTESTAZIONE.get(normalizzaIntestazione(c));
		if (campo) viste.add(campo);
	}
	return viste.size;
}

/** Il separatore che fa riconoscere più colonne nella prima riga. */
export function separatoreProbabile(testo: string): string {
	let migliore = ',';
	let punteggio = -1;

	for (const sep of SEPARATORI) {
		const righe = dividiCsv(testo, sep);
		const p = righe.length ? intestazioniRiconosciute(righe[0]) : 0;
		if (p > punteggio) {
			punteggio = p;
			migliore = sep;
		}
	}

	return migliore;
}

/* ------------------------------------------------------------------ *
 * Lettura
 * ------------------------------------------------------------------ */

const VERO = new Set(['si', 'sì', 'yes', 'true', 'vero', '1', 'x', 'gratis']);

/** `20:30`, `20.30`, `20:30:00`, `2030` → `20:30`. Vuoto se non è un'ora. */
function ora(v: string): string | null {
	const m = /^(\d{1,2})[:.]?(\d{2})(?::\d{2})?$/.exec(v.trim());
	if (!m) return null;
	const h = Number(m[1]);
	const min = Number(m[2]);
	if (h > 23 || min > 59) return null;
	return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** `2026-10-12`, `12/10/2026`, `12-10-2026` → `2026-10-12`. */
export function giorno(v: string): string | null {
	const t = v.trim();

	const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
	if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

	// Formato italiano: il giorno viene per primo. Non c'è ambiguità da
	// risolvere a naso — un CSV scritto in Italia non usa mai l'ordine
	// americano — e provare a indovinarla produrrebbe il 12 gennaio invece
	// del 1° dicembre senza che nessuno se ne accorga.
	const it = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(t);
	if (it) {
		const g = Number(it[1]);
		const m = Number(it[2]);
		if (g >= 1 && g <= 31 && m >= 1 && m <= 12) {
			return `${it[3]}-${String(m).padStart(2, '0')}-${String(g).padStart(2, '0')}`;
		}
	}

	return null;
}

/** La lineup dell'export è concatenata con ` · `; si accettano anche `,` e `/`. */
function lineupDa(v: string): VoceLineupParse[] {
	return v
		.split(/·|\||\/|,|;|\n/)
		.map((n) => n.trim())
		.filter(Boolean)
		.slice(0, 60)
		.map((name) => ({ name: name.slice(0, 200), billing: null }));
}

function generiDa(v: string): string[] {
	return v
		.split(/·|\||\/|,|;/)
		.map((n) => n.trim())
		.filter(Boolean);
}

/**
 * Legge la **prima** riga di dati del CSV.
 *
 * Una sola, per la stessa ragione dell'ICS: si compila un form, e un form è
 * una data (ADR-0033). Il totale torna al chiamante perché va detto.
 */
export function leggiCsv(testo: string): EsitoCsv {
	const separatore = separatoreProbabile(testo);
	const righe = dividiCsv(testo, separatore);
	const b = bersaglioVuoto();

	if (righe.length < 2) {
		b.incerti.push('Il file non contiene nessuna riga di dati sotto le intestazioni.');
		return { bersaglio: b, totaleRighe: Math.max(0, righe.length - 1) };
	}

	const campi = righe[0].map((c) => PER_INTESTAZIONE.get(normalizzaIntestazione(c)) ?? null);
	const valori = new Map<string, string>();
	const generiGrezzi: string[] = [];

	righe[1].forEach((cella, i) => {
		const campo = campi[i];
		const v = cella.trim();
		if (!campo || !v) return;

		// I generi si **sommano** invece di scegliersi. Il nostro export scrive
		// due colonne, `genere_principale` e `generi`, e la prima è contenuta
		// nella seconda: prendendone una sola si perderebbero i secondari
		// oppure il primario, a seconda dell'ordine delle colonne. Sommandole
		// e deduplicando dopo, l'ordine non conta.
		if (campo === 'genres') {
			generiGrezzi.push(v);
			return;
		}

		// Per tutto il resto la prima colonna che porta un valore vince: un
		// file con `prezzo` e `prezzo_prevendita` insieme non deve dipendere
		// dall'ordine di lettura.
		if (!valori.has(campo)) valori.set(campo, v);
	});

	const v = (campo: string) => valori.get(campo) ?? null;

	b.title = v('title');
	b.subtitle = v('subtitle');
	b.description = v('description');
	b.venueName = v('venueName');
	b.address = v('address');
	b.city = v('city');
	b.province = v('province')?.toUpperCase().slice(0, 2) ?? null;
	b.ticketUrl = v('ticketUrl');
	b.ageRestriction = v('ageRestriction');
	b.externalUrl = v('externalUrl');
	b.pricePresale = v('pricePresale');
	b.priceDoor = v('priceDoor');
	b.isFree = VERO.has((v('isFree') ?? '').toLowerCase());

	for (const grezzo of generiGrezzi) {
		for (const nome of generiDa(grezzo)) if (!b.genres.includes(nome)) b.genres.push(nome);
	}

	const lineup = v('lineup');
	if (lineup) b.lineup = lineupDa(lineup);

	/* Gli orari: `giorno` + `ora_inizio` separati come li scrive il nostro
	   export, oppure una colonna sola che li tiene insieme. */
	const completo = v('inizioCompleto');
	const g = giorno(v('giorno') ?? completo ?? '');
	const oi = ora(v('oraInizio') ?? '') ?? (completo ? ora(completo.split(/[T ]/)[1] ?? '') : null);

	if (g) {
		b.startsAtLocal = `${g}T${oi ?? '00:00'}`;
		if (!oi) {
			b.incerti.push('Nel file non c’era un orario di inizio: l’ora è da mettere.');
		}
		const of = ora(v('oraFine') ?? '');
		// La fine porta il giorno dell'inizio, tranne quando è dopo mezzanotte:
		// «22:00 → 02:00» è la fine della stessa serata, cioè il giorno dopo.
		if (of) b.endsAtLocal = `${of < (oi ?? '00:00') ? giornoDopo(g) : g}T${of}`;
	} else {
		b.incerti.push('Nel file non si riconosce nessuna data: va scritta a mano.');
	}

	return { bersaglio: b, totaleRighe: righe.length - 1 };
}

function giornoDopo(g: string): string {
	const [a, m, d] = g.split('-').map(Number);
	const t = new Date(Date.UTC(a, m - 1, d + 1));
	return t.toISOString().slice(0, 10);
}
