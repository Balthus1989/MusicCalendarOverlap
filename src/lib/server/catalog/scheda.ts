/**
 * Aggregazione della scheda operativa della band (ARCHITECTURE.md §4.7.2).
 *
 * **Codice puro, senza I/O.** Come le regole del motore conflitti, e per la
 * stessa ragione: è la parte in cui un errore non si vede. Un intervallo
 * sbagliato non solleva niente, non rompe nessuna pagina e resta lì.
 *
 * Il file risponde a una domanda sola: dato un mucchio di osservazioni,
 * **che cosa se ne può mostrare a chi non le ha scritte**. La risposta è
 * governata da ADR-0049 e sta tutta in tre numeri — la finestra, il minimo di
 * osservazioni, il minimo di organizzazioni distinte — dichiarati qui sotto e
 * da nessun'altra parte.
 *
 * L'eleggibilità delle righe (data passata, evento ancora `confirmed`) non è
 * qui: la applica la query in `osservazioni.ts`, perché è un join vivo su
 * `events.status` e non un fatto delle righe.
 */
import { giornoCivile } from '$lib/time';
import { FASCE, indiceFascia, MESI_FINESTRA } from '$lib/scheda';
import type {
	AggregatoCachet,
	AggregatoDurata,
	AggregatoRiferite,
	AggregatoVolume,
	Freschezza,
	MedianaPerRuolo,
	SchedaAggregata
} from '$lib/scheda';
import type {
	CachetBand as FasciaCondivisa,
	CachetScope as AmbitoCondiviso,
	VolumeAttrezzatura as VolumeCondiviso
} from '$lib/scheda';
import type {
	BillingRole,
	CachetBand,
	CachetScope,
	ObservationOrigin,
	VolumeAttrezzatura
} from '$lib/server/db/schema';

/* ------------------------------------------------------------------ *
 * Le tre costanti che governano tutto
 * ------------------------------------------------------------------ */

/**
 * La finestra è dichiarata in `$lib/scheda`, fuori da `server/`, perché la
 * legge anche l'informativa privacy: una sola costante, due lettori. È il modo
 * in cui ADR-0051 rende impossibile che la pagina dichiari una conservazione
 * diversa da quella applicata.
 */
export { MESI_FINESTRA };

/**
 * Minimo di osservazioni perché la fascia compaia.
 *
 * **Tre, non due**, e la ragione non è la robustezza statistica: con due
 * osservazioni un aggregato è invertibile da chi ne ha scritta una. Vale anche
 * pubblicando una mediana — su due valori la mediana sta fra i due, e chi
 * conosce il proprio sa da che parte cade l'altro. Vedi la correzione in
 * ADR-0049.
 */
export const MIN_OSSERVAZIONI = 3;

/**
 * Minimo di organizzazioni **distinte**. È il criterio che conta davvero:
 * dieci osservazioni della stessa organizzazione restano il quaderno di quella
 * organizzazione, e non superano niente.
 */
export const MIN_ORGANIZZAZIONI = 2;

/*
 * Le fasce, le etichette e l'ordine stanno in `$lib/scheda`: sono dati e nomi
 * in italiano, e li leggono anche i menù dei form. Qui serve solo l'ordine.
 *
 * Le tre righe sotto non producono codice: falliscono la compilazione se le
 * unioni di `$lib/scheda` smettono di combaciare con gli enum del database.
 * È il guinzaglio che rende sicura la ridichiarazione.
 */
type _AllineataFascia = CachetBand extends FasciaCondivisa
	? FasciaCondivisa extends CachetBand
		? true
		: never
	: never;
type _AllineatoAmbito = CachetScope extends AmbitoCondiviso
	? AmbitoCondiviso extends CachetScope
		? true
		: never
	: never;
type _AllineatoVolume = VolumeAttrezzatura extends VolumeCondiviso
	? VolumeCondiviso extends VolumeAttrezzatura
		? true
		: never
	: never;
const _controlli: [_AllineataFascia, _AllineatoAmbito, _AllineatoVolume] = [true, true, true];
void _controlli;

/* ------------------------------------------------------------------ *
 * Ciò che entra
 * ------------------------------------------------------------------ */

/** Una riga `artist_observations`, ridotta a ciò che serve per aggregare. */
export type OsservazionePura = {
	id: string;
	organizationId: string;
	origine: ObservationOrigin;
	fasciaCachet: CachetBand | null;
	cachetInclude: CachetScope | null;
	durataSetMinuti: number | null;
	volumeOsservato: VolumeAttrezzatura | null;
	/** `YYYY-MM-DD`: una `date` non ha fuso, e il confronto fra ISO è ordinato. */
	dataRiferimento: string;
	ruolo: BillingRole | null;
};

/* ------------------------------------------------------------------ *
 * Ciò che esce
 * ------------------------------------------------------------------ */

/*
 * I tipi del risultato stanno in `$lib/scheda` insieme alle etichette: sono la
 * forma con cui la scheda arriva alla pagina, e una pagina non può importare
 * niente da `server/`. Si ri-esportano da qui perché è qui che si calcolano.
 */
export type {
	AggregatoCachet,
	AggregatoDurata,
	AggregatoRiferite,
	AggregatoVolume,
	Freschezza,
	MedianaPerRuolo,
	SchedaAggregata
};

/* ------------------------------------------------------------------ *
 * Calcolo
 * ------------------------------------------------------------------ */

/** Il primo giorno che rientra ancora nella finestra, in forma `YYYY-MM-DD`. */
export function inizioFinestra(oggi: Date, mesi: number = MESI_FINESTRA): string {
	const giorno = giornoCivile(oggi);
	const [a, m, g] = giorno.split('-').map(Number);
	// `Date.UTC` normalizza da solo il riporto dei mesi, e su una data civile
	// senza fuso è l'aritmetica giusta: non c'è nessun cambio d'ora da temere.
	return new Date(Date.UTC(a, m - 1 - mesi, g)).toISOString().slice(0, 10);
}

function mediana(valori: number[]): number | null {
	if (!valori.length) return null;
	const ordinati = [...valori].sort((x, y) => x - y);
	const mezzo = Math.floor(ordinati.length / 2);
	if (ordinati.length % 2 === 1) return ordinati[mezzo];
	// Su un numero pari si arrotonda: i minuti di un set sono interi, e mezzo
	// minuto in più non è un'informazione.
	return Math.round((ordinati[mezzo - 1] + ordinati[mezzo]) / 2);
}

function modale<T extends string>(valori: T[]): T | null {
	if (!valori.length) return null;
	const conteggi = new Map<T, number>();
	for (const v of valori) conteggi.set(v, (conteggi.get(v) ?? 0) + 1);
	let vincitore: T | null = null;
	let massimo = 0;
	for (const [v, n] of conteggi) {
		// A parità vince il primo incontrato: l'ordine di arrivo è arbitrario
		// quanto qualunque altro criterio, e inventarne uno darebbe l'idea che
		// il dato sia più preciso di quanto è.
		if (n > massimo) {
			massimo = n;
			vincitore = v;
		}
	}
	return vincitore;
}

/**
 * La fascia mediana di un insieme.
 *
 * Su un numero pari si prende quella **più bassa** delle due centrali: fra due
 * risposte difendibili conviene quella che non gonfia il prezzo di una band
 * che di quel numero non sa niente.
 */
function fasciaMediana(fasce: CachetBand[]): CachetBand | null {
	if (!fasce.length) return null;
	const indici = fasce.map(indiceFascia).sort((x, y) => x - y);
	return FASCE[indici[Math.floor((indici.length - 1) / 2)]];
}

function freschezzaDa(date: string[], oggi: Date): Freschezza {
	const piuRecente = date.reduce((max, d) => (d > max ? d : max), date[0]);
	return piuRecente >= inizioFinestra(oggi, 12) ? 'ultimi_12_mesi' : 'da_12_a_24_mesi';
}

/**
 * Da un mucchio di osservazioni alla scheda che si può mostrare a chiunque.
 *
 * Non sa chi guarda: quello che si aggiunge per chi ha scritto — le proprie
 * righe, con data e serata — lo mette `serializeArtistCard`. Qui si calcola
 * solo la parte comune, quella che non è di nessuno.
 */
export function aggregaScheda(
	osservazioni: OsservazionePura[],
	oggi: Date = new Date()
): SchedaAggregata {
	const soglia = inizioFinestra(oggi);
	const nellaFinestra = osservazioni.filter((o) => o.dataRiferimento >= soglia);

	const osservate = nellaFinestra.filter((o) => o.origine === 'osservata');
	const riferite = nellaFinestra.filter((o) => o.origine === 'riferita');

	/* --- cachet ------------------------------------------------------ */

	const conCachet = osservate.filter((o) => o.fasciaCachet !== null);
	const organizzazioni = new Set(conCachet.map((o) => o.organizationId));

	let cachet: AggregatoCachet;
	if (!conCachet.length) {
		cachet = { stato: 'nessun_dato' };
	} else if (conCachet.length < MIN_OSSERVAZIONI || organizzazioni.size < MIN_ORGANIZZAZIONI) {
		cachet = { stato: 'sotto_soglia' };
	} else {
		cachet = {
			stato: 'disponibile',
			fascia: fasciaMediana(conCachet.map((o) => o.fasciaCachet as CachetBand))!,
			osservazioni: conCachet.length,
			organizzazioni: organizzazioni.size,
			// Il caso più frequente, non l'elenco dei casi: un elenco di due
			// convenzioni su due osservazioni si inverte come si invertivano
			// gli estremi, e per la stessa aritmetica.
			include: modale(conCachet.map((o) => o.cachetInclude).filter(Boolean) as CachetScope[]),
			freschezza: freschezzaDa(
				conCachet.map((o) => o.dataRiferimento),
				oggi
			)
		};
	}

	/* --- riferite ---------------------------------------------------- */

	const riferiteConCachet = riferite.filter((o) => o.fasciaCachet !== null);
	const fasciaRiferite = fasciaMediana(riferiteConCachet.map((o) => o.fasciaCachet as CachetBand));

	/* --- durata del set ---------------------------------------------- */

	const conDurata = osservate.filter((o) => o.durataSetMinuti !== null);
	const perRuolo: MedianaPerRuolo[] = [];
	const ruoli = new Set(conDurata.map((o) => o.ruolo).filter(Boolean) as BillingRole[]);
	for (const ruolo of ruoli) {
		const righe = conDurata.filter((o) => o.ruolo === ruolo);
		if (righe.length < 2) continue;
		const m = mediana(righe.map((o) => o.durataSetMinuti as number));
		if (m !== null) perRuolo.push({ ruolo, minuti: m, osservazioni: righe.length });
	}

	/* --- volume ------------------------------------------------------ */

	const conVolume = osservate.filter((o) => o.volumeOsservato !== null);

	return {
		cachet,
		riferite: { conteggio: riferite.length, fascia: fasciaRiferite },
		durata: {
			medianaMinuti: mediana(conDurata.map((o) => o.durataSetMinuti as number)),
			osservazioni: conDurata.length,
			perRuolo: perRuolo.sort((x, y) => y.osservazioni - x.osservazioni)
		},
		volume: {
			modale: modale(conVolume.map((o) => o.volumeOsservato as VolumeAttrezzatura)),
			osservazioni: conVolume.length
		}
	};
}
