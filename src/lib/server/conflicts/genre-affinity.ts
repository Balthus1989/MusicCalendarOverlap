/**
 * Affinità di genere (ARCHITECTURE.md §6.3).
 *
 * Due serate nella stessa sera e nella stessa zona si contendono il pubblico
 * solo se propongono qualcosa di simile: un death metal e un concerto di
 * cantautorato coesistono benissimo. Questo modulo mette un numero fra 0 e 1
 * su quel "simile", ed è ciò che separa la regola R3 dalla R4.
 *
 * Il numero si legge dai `path` materializzati della tassonomia (ADR-0007):
 * `metal.death-metal.tech-death` e `metal.death-metal` condividono due
 * segmenti su tre, e questo basta a dire che è la stessa serata per lo stesso
 * pubblico. Con tag liberi non ci sarebbe niente da confrontare.
 *
 * Codice puro, senza I/O, testato caso per caso: è metà del cuore del
 * prodotto, l'altra metà sono le regole che lo usano.
 */
import { commonPrefixDepth, depthOf, isAncestorPath } from '$lib/server/genres/path';

/** Sopra questa soglia due serate sono "dello stesso giro": regola R3. */
export const SOGLIA_AFFINITA = 0.4;

/** Sopra questa, e a distanza dimezzata, il conflitto R3 diventa `high`. */
export const SOGLIA_AFFINITA_ALTA = 0.7;

/**
 * Un genere secondario conta meno di uno primario: dichiarare "anche un po'
 * di post-rock" non rende la serata un concerto post-rock.
 */
export const PESO_PRIMARIO = 1.0;
export const PESO_SECONDARIO = 0.7;

export type GenereConPeso = {
	/** `path` materializzato: `metal.death-metal.tech-death`. */
	path: string;
	isPrimary: boolean;
};

/** Due decimali: è la precisione della colonna `conflicts.genre_affinity`. */
function aDueDecimali(v: number): number {
	return Math.round(v * 100) / 100;
}

const limita = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Affinità fra due singoli generi.
 *
 * I quattro casi di §6.3, nell'ordine in cui vanno provati:
 *
 * 1. stesso `path` → 1.0
 * 2. uno è antenato dell'altro → `0.9 - 0.1 × differenza di profondità`
 *    (Tech Death contro Death Metal: `0.9 - 0.1 = 0.8`)
 * 3. prefisso comune di _d_ segmenti, profondità massima _m_ → `d / (m + 1)`
 *    (Death Metal contro Black Metal: entrambi sotto `metal`, `1 / 2 = 0.5`)
 * 4. nessun segmento in comune → 0.0
 *
 * Il caso 2 va provato prima del 3 perché è più generoso, ed è giusto che lo
 * sia: un sottogenere e il suo genitore sono la stessa cosa a due livelli di
 * dettaglio, mentre due fratelli sono due cose diverse con un'origine comune.
 */
export function affinitaFraGeneri(a: string, b: string): number {
	if (a === b) return 1;

	if (isAncestorPath(a, b) || isAncestorPath(b, a)) {
		const scarto = Math.abs(depthOf(a) - depthOf(b));
		// Il `limita` non serve con una tassonomia profonda tre livelli, ma
		// una gerarchia più fonda produrrebbe numeri negativi, e un'affinità
		// negativa non significa niente.
		return aDueDecimali(limita(0.9 - 0.1 * scarto));
	}

	const comuni = commonPrefixDepth(a, b);
	if (comuni === 0) return 0;

	const profonditaMassima = Math.max(depthOf(a), depthOf(b));
	return aDueDecimali(comuni / (profonditaMassima + 1));
}

const pesoDi = (g: GenereConPeso) => (g.isPrimary ? PESO_PRIMARIO : PESO_SECONDARIO);

export type CoppiaDiGeneri = { pathA: string; pathB: string };

export type AffinitaDiEventi = {
	valore: number;
	/** La coppia che ha prodotto il massimo: serve a spiegare l'avviso. */
	coppia: CoppiaDiGeneri | null;
};

/**
 * Affinità fra due serate: il **massimo** su tutte le coppie di generi.
 *
 * Massimo e non media: se una delle due serate ha dichiarato cinque generi,
 * la media li premierebbe per aver descritto bene il cartellone. Ciò che
 * conta è se esiste almeno un motivo per cui lo stesso pubblico dovrebbe
 * scegliere fra le due.
 *
 * I pesi si moltiplicano fra loro: primario contro primario vale pieno,
 * primario contro secondario `0.7`, secondario contro secondario `0.49`.
 *
 * Un evento senza generi ha affinità 0 con chiunque. Non è un caso limite da
 * evitare: significa che finirà in R4 — "c'è un'altra serata in zona" — che è
 * esattamente ciò che si può onestamente dire di una serata di cui non si sa
 * nulla.
 */
export function affinitaFraEventi(
	generiA: GenereConPeso[],
	generiB: GenereConPeso[]
): AffinitaDiEventi {
	let valore = 0;
	let coppia: CoppiaDiGeneri | null = null;

	for (const a of generiA) {
		for (const b of generiB) {
			const punteggio = aDueDecimali(affinitaFraGeneri(a.path, b.path) * pesoDi(a) * pesoDi(b));
			if (punteggio > valore) {
				valore = punteggio;
				coppia = { pathA: a.path, pathB: b.path };
			}
		}
	}

	return { valore, coppia };
}
