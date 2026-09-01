/**
 * Lettura e scrittura delle osservazioni sulla scheda della band (ADR-0048).
 *
 * Qui sta tutto l'I/O, e **solo** l'I/O: la soglia, la finestra e gli aggregati
 * stanno in `scheda.ts`, che è codice puro e testato caso per caso. È la stessa
 * separazione che `conflicts/` ha per contratto, e per la stessa ragione — se
 * la regola vive dentro una query, l'unico modo di provarla è un database.
 *
 * L'unica regola che sta qui, e ci sta di proposito, è l'**eleggibilità**: una
 * osservazione conta solo se la data a cui è appesa è passata ed è ancora
 * `confirmed`. Non è un fatto della riga, è un join vivo su `events.status`:
 * una data che esce dal cartellone si porta via le sue osservazioni senza che
 * nessuno debba ricordarsene.
 */
import { asc, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '$lib/server/db/client';
import {
	artistObservations,
	artists,
	eventLineup,
	events,
	venues,
	type CachetBand,
	type CachetScope,
	type VolumeAttrezzatura
} from '$lib/server/db/schema';
import type { OsservazioneGrezza, SchedaGrezza } from '$lib/server/visibility';

/* ------------------------------------------------------------------ *
 * Lettura
 * ------------------------------------------------------------------ */

/**
 * La scheda di una band, prima di qualunque redazione.
 *
 * Restituisce **tutte** le osservazioni ammissibili, comprese quelle delle
 * altre organizzazioni: l'aggregato è un fatto del gruppo e non cambia a
 * seconda di chi guarda. Chi guarda lo decide `serializeArtistCard`, e nessun
 * handler deve restituire questo oggetto così com'è.
 */
export async function leggiSchedaGrezza(
	db: Database,
	artistId: string
): Promise<SchedaGrezza | null> {
	const righeArtista = await db
		.select({
			id: artists.id,
			schedaSpenta: artists.schedaSpenta,
			volumeAttrezzatura: artists.volumeAttrezzatura,
			personeInViaggio: artists.personeInViaggio,
			richiedeBackline: artists.richiedeBackline,
			durataSetMaxDichiarata: artists.durataSetMaxDichiarata
		})
		.from(artists)
		.where(eq(artists.id, artistId))
		.limit(1);

	const a = righeArtista[0];
	if (!a) return null;

	const righe = await db
		.select({
			id: artistObservations.id,
			organizationId: artistObservations.organizationId,
			origine: artistObservations.origine,
			fasciaCachet: artistObservations.fasciaCachet,
			cachetInclude: artistObservations.cachetInclude,
			durataSetMinuti: artistObservations.durataSetMinuti,
			volumeOsservato: artistObservations.volumeOsservato,
			dataRiferimento: artistObservations.dataRiferimento,
			ruolo: artistObservations.ruolo,
			capienzaVenue: artistObservations.capienzaVenue,
			regione: artistObservations.regione,
			eventId: events.id,
			titoloEvento: events.title,
			statoEvento: events.status
		})
		.from(artistObservations)
		.leftJoin(eventLineup, eq(eventLineup.id, artistObservations.eventLineupId))
		.leftJoin(events, eq(events.id, eventLineup.eventId))
		.where(eq(artistObservations.artistId, artistId))
		.orderBy(desc(artistObservations.dataRiferimento));

	const osservazioni: OsservazioneGrezza[] = righe
		// Una riferita non ha nessun evento dietro e resta sempre; una osservata
		// vale finché la sua data è in cartellone. Il filtro è qui e non nella
		// `where` perché la stessa query deve portare a casa entrambe.
		.filter((r) => r.origine === 'riferita' || r.statoEvento === 'confirmed')
		.map((r) => ({
			id: r.id,
			organizationId: r.organizationId,
			origine: r.origine,
			fasciaCachet: r.fasciaCachet,
			cachetInclude: r.cachetInclude,
			durataSetMinuti: r.durataSetMinuti,
			volumeOsservato: r.volumeOsservato,
			dataRiferimento: r.dataRiferimento,
			ruolo: r.ruolo,
			capienzaVenue: r.capienzaVenue,
			regione: r.regione,
			eventId: r.eventId,
			titoloEvento: r.titoloEvento
		}));

	return {
		artistId: a.id,
		schedaSpenta: a.schedaSpenta,
		dichiarati: {
			volumeAttrezzatura: a.volumeAttrezzatura,
			personeInViaggio: a.personeInViaggio,
			richiedeBackline: a.richiedeBackline,
			durataSetMaxDichiarata: a.durataSetMaxDichiarata
		},
		osservazioni
	};
}

/**
 * La riga di lineup a cui si vorrebbe appendere un'osservazione, con tutto ciò
 * che serve per decidere se si può e per congelarne il contesto.
 */
export type AncoraggioLineup = {
	lineupId: string;
	artistId: string | null;
	eventId: string;
	titoloEvento: string;
	organizationId: string;
	organizzazioneEsterna: boolean;
	/** La band ha chiesto di non avere una scheda operativa (ADR-0051). */
	schedaSpenta: boolean;
	status: (typeof events.status.enumValues)[number];
	startsAt: Date;
	ruolo: (typeof eventLineup.billing.enumValues)[number];
	capienzaVenue: number | null;
	regione: string | null;
};

export async function leggiAncoraggio(
	db: Database,
	eventLineupId: string
): Promise<AncoraggioLineup | null> {
	const righe = await db
		.select({
			lineupId: eventLineup.id,
			artistId: eventLineup.artistId,
			eventId: events.id,
			titoloEvento: events.title,
			organizationId: events.organizationId,
			organizzazioneEsterna: sql<boolean>`exists (
				select 1 from organizations o
				where o.id = ${events.organizationId} and o.esterna
			)`,
			schedaSpenta: sql<boolean>`coalesce(${artists.schedaSpenta}, false)`,
			status: events.status,
			startsAt: events.startsAt,
			ruolo: eventLineup.billing,
			capienzaVenue: venues.capacity,
			regione: events.region
		})
		.from(eventLineup)
		.innerJoin(events, eq(events.id, eventLineup.eventId))
		.leftJoin(venues, eq(venues.id, events.venueId))
		.leftJoin(artists, eq(artists.id, eventLineup.artistId))
		.where(eq(eventLineup.id, eventLineupId))
		.limit(1);

	return righe[0] ?? null;
}

/**
 * Le band in cartellone di una data, con l'annotazione già scritta se c'è.
 *
 * È ciò che riempie il riquadro «com'è andata?» sulla pagina della serata. Le
 * band fuori anagrafica non compaiono: senza una scheda non c'è niente a cui
 * appendere l'osservazione, ed è anche il motivo per cui la voce giusta da
 * mostrare lì è "aggiungila all'anagrafica" e non un campo in più.
 */
export type BandDaAnnotare = {
	lineupId: string;
	artistId: string;
	nomeBand: string;
	schedaSpenta: boolean;
	osservazione: (ValoriOsservazione & { id: string }) | null;
};

export async function annotazioniDellEvento(
	db: Database,
	eventId: string
): Promise<BandDaAnnotare[]> {
	const righe = await db
		.select({
			lineupId: eventLineup.id,
			artistId: artists.id,
			nomeBand: artists.name,
			schedaSpenta: artists.schedaSpenta,
			osservazioneId: artistObservations.id,
			fasciaCachet: artistObservations.fasciaCachet,
			cachetInclude: artistObservations.cachetInclude,
			durataSetMinuti: artistObservations.durataSetMinuti,
			volumeOsservato: artistObservations.volumeOsservato
		})
		.from(eventLineup)
		.innerJoin(artists, eq(artists.id, eventLineup.artistId))
		.leftJoin(artistObservations, eq(artistObservations.eventLineupId, eventLineup.id))
		.where(eq(eventLineup.eventId, eventId))
		.orderBy(asc(eventLineup.position));

	return righe.map((r) => ({
		lineupId: r.lineupId,
		artistId: r.artistId,
		nomeBand: r.nomeBand,
		schedaSpenta: r.schedaSpenta,
		osservazione: r.osservazioneId
			? {
					id: r.osservazioneId,
					fasciaCachet: r.fasciaCachet,
					cachetInclude: r.cachetInclude,
					durataSetMinuti: r.durataSetMinuti,
					volumeOsservato: r.volumeOsservato
				}
			: null
	}));
}

/* ------------------------------------------------------------------ *
 * Scrittura
 * ------------------------------------------------------------------ */

export type ValoriOsservazione = {
	fasciaCachet: CachetBand | null;
	cachetInclude: CachetScope | null;
	durataSetMinuti: number | null;
	volumeOsservato: VolumeAttrezzatura | null;
};

/**
 * Annota che cosa è successo su una propria data.
 *
 * Riscrive se esiste già: una riga di lineup produce **una** osservazione, e
 * correggere ciò che si è scritto ieri è la cosa che si vuole poter fare. Il
 * contesto — data, ruolo, capienza, regione — si congela adesso e non si
 * ricalcola mai più, perché un evento modificato dopo non deve riscrivere il
 * contesto di un'osservazione già data.
 */
export async function scriviOsservazione(
	db: Database,
	ancoraggio: AncoraggioLineup,
	organizationId: string,
	profileId: string,
	valori: ValoriOsservazione
): Promise<void> {
	if (!ancoraggio.artistId) {
		throw new Error('Una band fuori anagrafica non ha una scheda su cui annotare.');
	}

	const giorno = ancoraggio.startsAt.toISOString().slice(0, 10);

	await db
		.insert(artistObservations)
		.values({
			artistId: ancoraggio.artistId,
			organizationId,
			createdBy: profileId,
			origine: 'osservata',
			eventLineupId: ancoraggio.lineupId,
			dataRiferimento: giorno,
			ruolo: ancoraggio.ruolo,
			capienzaVenue: ancoraggio.capienzaVenue,
			regione: ancoraggio.regione,
			...valori
		})
		.onConflictDoUpdate({
			target: artistObservations.eventLineupId,
			set: { ...valori, updatedAt: new Date() }
		});
}

/**
 * Lascia (o sostituisce) il sentito dire della propria organizzazione su una
 * band. Una per organizzazione per band: il conflitto sull'indice parziale non
 * è un errore da segnalare, è la sostituzione che ci si aspetta.
 */
export async function scriviRiferita(
	db: Database,
	artistId: string,
	organizationId: string,
	profileId: string,
	annoRiferimento: number,
	valori: ValoriOsservazione
): Promise<void> {
	await db
		.insert(artistObservations)
		.values({
			artistId,
			organizationId,
			createdBy: profileId,
			origine: 'riferita',
			eventLineupId: null,
			// Un sentito dire non ha un giorno: si àncora a metà dell'anno
			// dichiarato, che è il modo meno sbagliato di collocarlo nella
			// finestra senza fingere una precisione che non ha.
			dataRiferimento: `${annoRiferimento}-06-30`,
			...valori
		})
		.onConflictDoUpdate({
			target: [artistObservations.artistId, artistObservations.organizationId],
			targetWhere: eq(artistObservations.origine, 'riferita'),
			set: { ...valori, dataRiferimento: `${annoRiferimento}-06-30`, updatedAt: new Date() }
		});
}

/** Ritira un'osservazione. Le righe si cancellano davvero: non c'è niente da conservare. */
export async function cancellaOsservazione(db: Database, id: string): Promise<void> {
	await db.delete(artistObservations).where(eq(artistObservations.id, id));
}

/** A chi appartiene un'osservazione, per il controllo di permesso. */
export async function proprietarioOsservazione(
	db: Database,
	id: string
): Promise<{ organizationId: string; artistId: string } | null> {
	const righe = await db
		.select({
			organizationId: artistObservations.organizationId,
			artistId: artistObservations.artistId
		})
		.from(artistObservations)
		.where(eq(artistObservations.id, id))
		.limit(1);
	return righe[0] ?? null;
}

/**
 * Spegne o riaccende la scheda su richiesta della band (ADR-0051).
 *
 * Spegnere non cancella: se la band chiede la cancellazione e non solo
 * l'opposizione, si cancella con `cancellaOsservazioniDi`. Sono due richieste
 * diverse e meritano due risposte diverse.
 */
export async function impostaSchedaSpenta(
	db: Database,
	artistId: string,
	spenta: boolean
): Promise<void> {
	await db
		.update(artists)
		.set({ schedaSpenta: spenta, updatedAt: new Date() })
		.where(eq(artists.id, artistId));
}

/** Cancella davvero tutte le osservazioni su una band: sono righe, non c'è altro. */
export async function cancellaOsservazioniDi(db: Database, artistId: string): Promise<number> {
	const righe = await db
		.delete(artistObservations)
		.where(eq(artistObservations.artistId, artistId))
		.returning({ id: artistObservations.id });
	return righe.length;
}
