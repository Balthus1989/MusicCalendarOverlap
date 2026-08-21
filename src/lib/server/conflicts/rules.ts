/**
 * Le quattro regole di rilevamento (ARCHITECTURE.md §6.2).
 *
 * Codice puro: nessuna query, nessun `fetch`, nessuna data "adesso". Ogni
 * regola riceve due eventi già pronti e restituisce un conflitto o `null`.
 * È il cuore del prodotto e l'unico punto in cui un bug costa davvero
 * qualcosa, quindi è anche l'unico che si testa caso per caso.
 *
 * **I due eventi arrivano già ordinati** (`a.id < b.id`): li ordina
 * `engine.ts`, perché è l'ordine con cui la coppia finisce nel database e
 * perché i dettagli parlano di "lato A" e "lato B". Le regole non devono
 * riordinare niente.
 *
 * Che cosa *non* fanno queste funzioni: decidere chi può vedere il conflitto.
 * Quella è materia di `serializeConflict` (ADR-0024). Qui si rileva ciò che è
 * vero; la redazione avviene in uscita, come per gli eventi.
 */
import type { ConflictKind, ConflictSeverity } from '$lib/server/db/schema';
import { distanzaInGiorniCivili, fineEffettiva } from '$lib/time';
import { distanzaKm, haCoordinate } from './geo';
import {
	affinitaFraEventi,
	SOGLIA_AFFINITA,
	SOGLIA_AFFINITA_ALTA,
	type CoppiaDiGeneri,
	type GenereConPeso
} from './genre-affinity';

/* ------------------------------------------------------------------ *
 * Costanti di regola
 * ------------------------------------------------------------------ */

/**
 * Finestra della regola R2, in giorni civili (ADR-0021).
 *
 * Era ±14, presa dalle clausole di esclusiva dei contratti di booking. Ma R2
 * non serve a far rispettare un contratto: serve ad avvisare due
 * organizzatori che si contendono lo stesso pubblico, e quell'effetto dopo
 * una settimana è finito.
 */
export const FINESTRA_ARTISTI_GIORNI = 7;

/** Oltre questa distanza due date non si contendono nessuno. */
export const DISTANZA_MASSIMA_ARTISTI_KM = 200;

/* ------------------------------------------------------------------ *
 * Ciò che una regola riceve
 * ------------------------------------------------------------------ */

export type VoceLineupPerConflitti = {
	artistId: string;
	/** Se falso, la band non è ancora uscita pubblicamente da questa parte. */
	isAnnounced: boolean;
};

export type EventoPerConflitti = {
	id: string;
	organizationId: string;
	venueId: string | null;
	startsAt: Date;
	endsAt: Date | null;
	doorsAt: Date | null;
	lat: number | null;
	lon: number | null;
	/**
	 * Raggio già risolto: l'override dell'evento se c'è, altrimenti il
	 * predefinito dell'organizzazione. La risoluzione tocca a chi legge dal
	 * database, così qui non serve conoscere le organizzazioni.
	 */
	raggioKm: number;
	generi: GenereConPeso[];
	/** Solo le voci collegate all'anagrafica: senza `artist_id` non c'è nulla da confrontare. */
	lineup: VoceLineupPerConflitti[];
};

/* ------------------------------------------------------------------ *
 * Ciò che una regola restituisce
 * ------------------------------------------------------------------ */

/**
 * Un artista in comune fra le due date.
 *
 * I due flag dicono su quale lato quella band è già stata annunciata
 * pubblicamente. Non sono un dettaglio di presentazione: sono il dato su cui
 * `serializeConflict` decide se un organizzatore può sapere di questo
 * conflitto e sentirne il nome (ADR-0024).
 */
export type ArtistaCondiviso = {
	artistId: string;
	annunciatoA: boolean;
	annunciatoB: boolean;
};

export type DettagliConflitto = {
	artisti?: ArtistaCondiviso[];
	generi?: CoppiaDiGeneri;
	venueId?: string;
	sovrapposizioneMinuti?: number;
};

export type ConflittoRilevato = {
	kind: ConflictKind;
	severity: ConflictSeverity;
	distanzaKm: number | null;
	affinita: number | null;
	giorniDiDistanza: number;
	dettagli: DettagliConflitto;
};

/* ------------------------------------------------------------------ *
 * Utilità condivise
 * ------------------------------------------------------------------ */

/**
 * Distanza fra due eventi, o `null` se a uno dei due mancano le coordinate.
 *
 * Un evento senza coordinate resta fuori da **tutte** le regole geografiche,
 * R2 compresa. È la stessa conseguenza già accettata in ADR-0008, e la rete
 * di sicurezza è a monte: il salvataggio geocodifica la città quando manca il
 * locale, e `motiviCheImpediscono` la città la pretende sempre.
 */
export function distanzaFra(a: EventoPerConflitti, b: EventoPerConflitti): number | null {
	if (!haCoordinate(a) || !haCoordinate(b)) return null;
	return distanzaKm({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon });
}

/** Un decimale: è la precisione della colonna `conflicts.distance_km`. */
const aUnDecimale = (v: number) => Math.round(v * 10) / 10;

/**
 * L'intervallo che una serata occupa davvero.
 *
 * Comincia all'apertura delle porte, non al primo accordo: due concerti nello
 * stesso locale che si sovrappongono di un'ora di soundcheck sono comunque
 * impossibili. Finisce a `ends_at`, o a quattro ore dall'inizio se nessuno
 * l'ha scritto (ARCHITECTURE.md §4.4).
 */
function intervallo(e: EventoPerConflitti): { inizio: number; fine: number } {
	const inizio = Math.min(e.startsAt.getTime(), e.doorsAt?.getTime() ?? Infinity);
	return { inizio, fine: fineEffettiva(e.startsAt, e.endsAt).getTime() };
}

/**
 * Raggio effettivo della coppia: il **minore** dei due.
 *
 * Il minore e non il maggiore: il raggio è la dichiarazione di quanto lontano
 * un'organizzazione considera di essere disturbata. Prendere il maggiore
 * imporrebbe a chi ne ha scelto uno stretto gli avvisi di chi lo ha largo.
 */
export function raggioEffettivo(a: EventoPerConflitti, b: EventoPerConflitti): number {
	return Math.min(a.raggioKm, b.raggioKm);
}

/* ------------------------------------------------------------------ *
 * R1 — venue_clash
 * ------------------------------------------------------------------ */

/**
 * Due date nello stesso locale che si accavallano nel tempo.
 *
 * Sempre `high`, e per una ragione diversa dalle altre regole: non è una
 * scelta strategica su cui due organizzatori possano ragionevolmente
 * dissentire, è un errore materiale. O il locale ha promesso la stessa sera a
 * due persone, o qualcuno ha sbagliato a digitare la data.
 */
export function venueClash(a: EventoPerConflitti, b: EventoPerConflitti): ConflittoRilevato | null {
	if (!a.venueId || !b.venueId || a.venueId !== b.venueId) return null;

	const ia = intervallo(a);
	const ib = intervallo(b);
	const inizio = Math.max(ia.inizio, ib.inizio);
	const fine = Math.min(ia.fine, ib.fine);
	// Estremi che si toccano non sono una sovrapposizione: una serata che
	// finisce quando l'altra apre le porte è stretta, non impossibile.
	if (fine <= inizio) return null;

	const km = distanzaFra(a, b);

	return {
		kind: 'venue_clash',
		severity: 'high',
		distanzaKm: km === null ? null : aUnDecimale(km),
		affinita: null,
		giorniDiDistanza: distanzaInGiorniCivili(a.startsAt, b.startsAt),
		dettagli: {
			venueId: a.venueId,
			sovrapposizioneMinuti: Math.round((fine - inizio) / 60000)
		}
	};
}

/* ------------------------------------------------------------------ *
 * R2 — artist_overlap
 * ------------------------------------------------------------------ */

/**
 * Gravità in funzione dei giorni civili di distanza (ADR-0021).
 *
 * Le fasce si raccontano in una riga, che è il motivo per cui non è una
 * formula continua: chi riceve l'avviso deve poter capire perché è arrivato.
 *
 * | giorni | severity | perché                                            |
 * | ------ | -------- | ------------------------------------------------- |
 * | 0      | `high`   | non è concorrenza, è un doppio ingaggio           |
 * | 1–2    | `high`   | stesso fine settimana, stesso pubblico            |
 * | 3–5    | `medium` | il pubblico si sovrappone in larga parte          |
 * | 6–7    | `low`    | informativo                                       |
 * | oltre  | nessuno  | due date non si danno più fastidio                |
 */
export function severitaPerGiorni(giorni: number): ConflictSeverity | null {
	if (giorni > FINESTRA_ARTISTI_GIORNI) return null;
	if (giorni <= 2) return 'high';
	if (giorni <= 5) return 'medium';
	return 'low';
}

/** Vero quando il conflitto sugli artisti è un errore materiale, non una concorrenza. */
export function eDoppioIngaggio(conflitto: ConflittoRilevato): boolean {
	return conflitto.kind === 'artist_overlap' && conflitto.giorniDiDistanza === 0;
}

function artistiCondivisi(a: EventoPerConflitti, b: EventoPerConflitti): ArtistaCondiviso[] {
	// Una band può comparire due volte nella stessa lineup (due set, due
	// palchi): basta che sia annunciata una volta perché il nome sia pubblico.
	const perArtistaA = new Map<string, boolean>();
	for (const v of a.lineup) {
		perArtistaA.set(v.artistId, (perArtistaA.get(v.artistId) ?? false) || v.isAnnounced);
	}

	const perArtistaB = new Map<string, boolean>();
	for (const v of b.lineup) {
		perArtistaB.set(v.artistId, (perArtistaB.get(v.artistId) ?? false) || v.isAnnounced);
	}

	const condivisi: ArtistaCondiviso[] = [];
	for (const [artistId, annunciatoA] of perArtistaA) {
		const annunciatoB = perArtistaB.get(artistId);
		if (annunciatoB === undefined) continue;
		condivisi.push({ artistId, annunciatoA, annunciatoB });
	}
	return condivisi;
}

/**
 * La stessa band su due date vicine di organizzazioni diverse.
 *
 * Il confronto usa le lineup **intere**, non solo le voci annunciate, e la
 * ragione è che una rilevazione filtrata non sarebbe simmetrica: salvando una
 * delle due date il conflitto comparirebbe, salvando l'altra sparirebbe.
 * Ciò che si filtra è quanto se ne racconta, in `serializeConflict`
 * (ADR-0024).
 *
 * Resta però una condizione da soddisfare **qui**: se la band è segreta da
 * entrambe le parti, nessuno dei due organizzatori potrà mai sentirsi dire
 * niente, e una riga che nessuno può vedere è solo un dato sensibile in più
 * conservato senza scopo. In quel caso il conflitto non si registra affatto —
 * ed è una condizione simmetrica, quindi non reintroduce il problema.
 */
export function artistOverlap(
	a: EventoPerConflitti,
	b: EventoPerConflitti
): ConflittoRilevato | null {
	const giorni = distanzaInGiorniCivili(a.startsAt, b.startsAt);
	const severity = severitaPerGiorni(giorni);
	if (!severity) return null;

	const km = distanzaFra(a, b);
	if (km === null || km > DISTANZA_MASSIMA_ARTISTI_KM) return null;

	const condivisi = artistiCondivisi(a, b);
	if (!condivisi.length) return null;
	if (!condivisi.some((x) => x.annunciatoA || x.annunciatoB)) return null;

	return {
		kind: 'artist_overlap',
		severity,
		distanzaKm: aUnDecimale(km),
		affinita: null,
		giorniDiDistanza: giorni,
		dettagli: { artisti: condivisi }
	};
}

/* ------------------------------------------------------------------ *
 * R3 e R4 — stesso giorno, stessa zona
 * ------------------------------------------------------------------ */

type BaseGeografica = {
	km: number;
	raggio: number;
	affinita: number;
	coppia: CoppiaDiGeneri | null;
};

/**
 * Il tronco comune di R3 e R4: stesso giorno civile ed entro il raggio.
 * Ciò che le separa è solo l'affinità di genere.
 */
function baseGeografica(a: EventoPerConflitti, b: EventoPerConflitti): BaseGeografica | null {
	if (distanzaInGiorniCivili(a.startsAt, b.startsAt) !== 0) return null;

	const km = distanzaFra(a, b);
	if (km === null) return null;

	const raggio = raggioEffettivo(a, b);
	if (km > raggio) return null;

	const { valore, coppia } = affinitaFraEventi(a.generi, b.generi);
	return { km, raggio, affinita: valore, coppia };
}

/**
 * Stessa sera, stessa zona, generi affini: le due serate si contendono
 * davvero lo stesso pubblico.
 *
 * `high` quando l'affinità è alta **e** la distanza è meno di metà del
 * raggio: entrambe le condizioni, perché due death metal a sessanta
 * chilometri sono un problema minore di due death metal in due quartieri
 * della stessa città.
 */
export function geoGenreOverlap(
	a: EventoPerConflitti,
	b: EventoPerConflitti
): ConflittoRilevato | null {
	const base = baseGeografica(a, b);
	if (!base || base.affinita < SOGLIA_AFFINITA) return null;

	const molto = base.affinita >= SOGLIA_AFFINITA_ALTA && base.km <= base.raggio / 2;

	return {
		kind: 'geo_genre_overlap',
		severity: molto ? 'high' : 'medium',
		distanzaKm: aUnDecimale(base.km),
		affinita: base.affinita,
		giorniDiDistanza: 0,
		dettagli: base.coppia ? { generi: base.coppia } : {}
	};
}

/**
 * Stessa sera, stessa zona, generi lontani.
 *
 * Sempre `low`, e non genera notifiche: è l'informazione "c'è un'altra serata
 * in zona", che a un organizzatore serve per sapere che quella sera la città
 * è viva, non per cambiare i propri piani.
 */
export function sameDayProximity(
	a: EventoPerConflitti,
	b: EventoPerConflitti
): ConflittoRilevato | null {
	const base = baseGeografica(a, b);
	if (!base || base.affinita >= SOGLIA_AFFINITA) return null;

	return {
		kind: 'same_day_proximity',
		severity: 'low',
		distanzaKm: aUnDecimale(base.km),
		affinita: base.affinita,
		giorniDiDistanza: 0,
		dettagli: base.coppia ? { generi: base.coppia } : {}
	};
}

/** Le quattro regole, nell'ordine in cui hanno senso per chi legge un avviso. */
export const REGOLE = [venueClash, artistOverlap, geoGenreOverlap, sameDayProximity] as const;
