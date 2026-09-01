/**
 * Le costanti e le etichette della scheda operativa della band.
 *
 * Sta **fuori** da `$lib/server` di proposito: le stesse tre cose servono al
 * calcolo dell'aggregato (server), ai menù dei form e all'informativa privacy
 * (pagine). Duplicarle sarebbe il modo più facile di far divergere ciò che il
 * codice fa da ciò che l'informativa dichiara — che è esattamente il guasto
 * che ADR-0051 vuole rendere impossibile.
 *
 * Non c'è niente di segreto qui dentro: una scala di fasce e dei nomi in
 * italiano. La logica di soglia, che è la parte delicata, sta in
 * `server/catalog/scheda.ts`.
 */
/*
 * I tre tipi sono ridichiarati qui invece di essere importati da
 * `$lib/server/db/schema`: quel modulo è server-only, e un `import type` verso
 * una cartella `server` è un invito a trasformarlo per sbaglio in un import
 * vero. Che restino allineati agli enum del database lo garantisce il
 * controllo in fondo a `server/catalog/scheda.ts`, che non compila se
 * divergono.
 */
export type CachetBand =
	'fino_a_300' | '300_600' | '600_1200' | '1200_2500' | '2500_5000' | 'oltre_5000';

export type CachetScope = 'solo_cachet' | 'cachet_e_viaggio' | 'tutto_incluso';

export type VolumeAttrezzatura =
	'solo_voce' | 'acustico' | 'backline_leggera' | 'furgone' | 'furgone_grande' | 'camion';

export type RuoloCartellone =
	'headliner' | 'co_headliner' | 'special_guest' | 'support' | 'opener' | 'dj' | 'tba';

/* ------------------------------------------------------------------ *
 * La forma con cui la scheda arriva alla pagina
 * ------------------------------------------------------------------ */

/**
 * A blocchi grossi, mai la data esatta: su una band di nicchia una data esatta
 * dice già chi l'ha portata.
 */
export type Freschezza = 'ultimi_12_mesi' | 'da_12_a_24_mesi';

export type AggregatoCachet =
	| { stato: 'nessun_dato' }
	/**
	 * Ci sono osservazioni, ma non abbastanza o non da abbastanza
	 * organizzazioni. Chi guarda non deve sapere **quante** ne mancano: "manca
	 * una sola osservazione" è già un'informazione sul conteggio.
	 */
	| { stato: 'sotto_soglia' }
	| {
			stato: 'disponibile';
			/**
			 * **Una fascia sola, la mediana — non gli estremi.**
			 *
			 * Pubblicare minimo e massimo sembrava più informativo ed è invece
			 * il modo di annullare la soglia: chi ha contribuito conosce il
			 * proprio valore, e su un insieme piccolo ricava gli altri per
			 * sottrazione. Una mediana non si inverte.
			 */
			fascia: CachetBand;
			osservazioni: number;
			organizzazioni: number;
			/** Il caso più frequente, non l'elenco: un elenco si inverte come gli estremi. */
			include: CachetScope | null;
			freschezza: Freschezza;
	  };

export type MedianaPerRuolo = { ruolo: RuoloCartellone; minuti: number; osservazioni: number };

export type AggregatoDurata = {
	medianaMinuti: number | null;
	osservazioni: number;
	/** Solo i ruoli con almeno due osservazioni: sotto, la mediana è il dato. */
	perRuolo: MedianaPerRuolo[];
};

export type AggregatoVolume = { modale: VolumeAttrezzatura | null; osservazioni: number };

/**
 * Il sentito dire, tenuto separato e contato a parte. Non entra in nessun
 * aggregato e non concorre a nessuna soglia: «queste le abbiamo viste, queste
 * ce le hanno raccontate» (ADR-0049).
 */
export type AggregatoRiferite = {
	conteggio: number;
	/** Mediana anche qui, e per la stessa ragione: due riferite si invertono. */
	fascia: CachetBand | null;
};

export type SchedaAggregata = {
	cachet: AggregatoCachet;
	riferite: AggregatoRiferite;
	durata: AggregatoDurata;
	volume: AggregatoVolume;
};

/** I fatti dichiarati: non si redigono, sono uguali per tutti come il nome. */
export type FattiDichiarati = {
	volumeAttrezzatura: VolumeAttrezzatura | null;
	personeInViaggio: number | null;
	richiedeBackline: boolean | null;
	durataSetMaxDichiarata: number | null;
};

/** Un'osservazione propria, mostrata per intero solo a chi l'ha scritta. */
export type MiaOsservazione = {
	id: string;
	origine: 'osservata' | 'riferita';
	fasciaCachet: CachetBand | null;
	cachetInclude: CachetScope | null;
	durataSetMinuti: number | null;
	volumeOsservato: VolumeAttrezzatura | null;
	dataRiferimento: string;
	ruolo: RuoloCartellone | null;
	capienzaVenue: number | null;
	eventId: string | null;
	titoloEvento: string | null;
};

export type SchedaSerializzata = {
	artistId: string;
	dichiarati: FattiDichiarati;
	comune: SchedaAggregata;
	mie: MiaOsservazione[];
};

/**
 * Un prezzo di tre anni fa non è un prezzo, è un ricordo. La finestra mobile
 * fa scadere il dato da sé, senza che nessuno debba fare pulizia.
 *
 * **È la scadenza dichiarata in `/privacy`.** Cambiarla senza cambiare quella
 * pagina produce un'informativa falsa, che è peggio di nessuna informativa
 * (ADR-0051).
 */
export const MESI_FINESTRA = 24;

/**
 * Le sei fasce, ordinate dal basso. L'ordine è l'unica cosa che serve per
 * calcolare un intervallo: non si fanno medie di fasce, si prende la minima e
 * la massima.
 *
 * I confini sono un'ipotesi scritta a tavolino su un giro di club e
 * associazioni: è il punto aperto 9, e si chiude guardando i dati veri.
 */
export const FASCE: readonly CachetBand[] = [
	'fino_a_300',
	'300_600',
	'600_1200',
	'1200_2500',
	'2500_5000',
	'oltre_5000'
] as const;

export const ETICHETTE_FASCE: Record<CachetBand, string> = {
	fino_a_300: 'fino a 300 €',
	'300_600': '300 – 600 €',
	'600_1200': '600 – 1.200 €',
	'1200_2500': '1.200 – 2.500 €',
	'2500_5000': '2.500 – 5.000 €',
	oltre_5000: 'oltre 5.000 €'
};

export const ETICHETTE_INCLUDE: Record<CachetScope, string> = {
	solo_cachet: 'solo cachet',
	cachet_e_viaggio: 'cachet e viaggio',
	tutto_incluso: 'tutto incluso'
};

export const ETICHETTE_VOLUME: Record<VolumeAttrezzatura, string> = {
	solo_voce: 'solo voce',
	acustico: 'acustico',
	backline_leggera: 'backline leggera',
	furgone: 'furgone',
	furgone_grande: 'furgone grande',
	camion: 'camion'
};

export const ETICHETTE_RUOLO: Record<string, string> = {
	headliner: 'headliner',
	co_headliner: 'co-headliner',
	special_guest: 'special guest',
	support: 'support',
	opener: 'opener',
	dj: 'dj',
	tba: 'da annunciare'
};

/** Posizione nella scala, per confrontare due fasce. */
export function indiceFascia(f: CachetBand): number {
	return FASCE.indexOf(f);
}

/* ------------------------------------------------------------------ *
 * Opzioni per i menù dei form
 * ------------------------------------------------------------------ */

const vuota = { value: '', label: '— non lo so —' };

export const OPZIONI_FASCIA = [
	vuota,
	...FASCE.map((f) => ({ value: f, label: ETICHETTE_FASCE[f] }))
];

export const OPZIONI_INCLUDE = [
	vuota,
	...(Object.keys(ETICHETTE_INCLUDE) as CachetScope[]).map((k) => ({
		value: k,
		label: ETICHETTE_INCLUDE[k]
	}))
];

export const OPZIONI_VOLUME = [
	vuota,
	...(Object.keys(ETICHETTE_VOLUME) as VolumeAttrezzatura[]).map((k) => ({
		value: k,
		label: ETICHETTE_VOLUME[k]
	}))
];

export const OPZIONI_BACKLINE = [
	{ value: '', label: '— non lo so —' },
	{ value: 'si', label: 'sì, se la aspettano sul posto' },
	{ value: 'no', label: 'no, portano tutto' }
];

export const ETICHETTE_FRESCHEZZA = {
	ultimi_12_mesi: 'ultimi 12 mesi',
	da_12_a_24_mesi: 'fra 12 e 24 mesi fa'
} as const;
