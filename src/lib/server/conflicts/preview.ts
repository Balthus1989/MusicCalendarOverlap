/**
 * Anteprima dei conflitti su una bozza non ancora salvata (§6.5).
 *
 * È la feature che decide se il motore serve a qualcosa: un conflitto scoperto
 * dopo il salvataggio è già una telefonata imbarazzante, uno scoperto mentre
 * si sceglie la data è solo una data diversa.
 *
 * Gira lo **stesso** motore della riconciliazione, in sola lettura: se
 * l'anteprima e il salvataggio usassero due strade diverse, la prima cosa che
 * imparerebbe un organizzatore è che l'avviso in pagina non è affidabile.
 *
 * Il warning non blocca mai il salvataggio (ADR-0009) e non impedisce di
 * confermare (ADR-0022): mostra, e propone di sentirsi.
 */
import { eq, inArray } from 'drizzle-orm';
import type { BozzaConflitti } from '$lib/schemas/conflict';
import type { AnteprimaConflitto, EsitoAnteprima } from '$lib/conflicts';
import type { Database } from '$lib/server/db/client';
import { artists, genres, organizations, venues } from '$lib/server/db/schema';
import { caricaEventi } from '$lib/server/events/queries';
import { geocode } from '$lib/server/geocode';
import { redigiConflitto, serializeEvent, type ViewerContext } from '$lib/server/visibility';
import { daLocaleAIstante } from '$lib/time';
import { rilevaConflitti } from './engine';
import { candidati } from './reconcile';
import type { EventoPerConflitti, VoceLineupPerConflitti } from './rules';

/**
 * Id fittizio per una data mai salvata.
 *
 * Tutto zeri, così `ordinaCoppia` la mette sempre dal lato A: l'ordinamento
 * resta deterministico anche per una riga che nel database non esiste.
 */
const ID_BOZZA = '00000000-0000-0000-0000-000000000000';

const nulla = (motivo: string): EsitoAnteprima => ({ conflitti: [], incompleto: motivo });

/** Sotto tre caratteri una città non è ancora una città: si evita di geocodificare "Pe". */
const CITTA_MINIMA = 3;

type Coordinate = { lat: number | null; lon: number | null };

/**
 * Le coordinate della bozza, con la stessa scala di fiducia del salvataggio
 * (`events/write.ts`): prima il locale, poi il geocoding della città.
 *
 * Deve essere la stessa, altrimenti l'anteprima calcola le distanze da un
 * punto e il salvataggio da un altro, e i due elenchi di conflitti non
 * coincidono. Il geocoding passa dalla cache su database: la prima ricerca in
 * una città costa una chiamata di rete, le successive no.
 */
async function coordinateDellaBozza(
	db: Database,
	bozza: BozzaConflitti,
	venue: { lat: number; lon: number } | null
): Promise<Coordinate> {
	if (venue) return { lat: venue.lat, lon: venue.lon };
	if (bozza.city.trim().length < CITTA_MINIMA) return { lat: null, lon: null };

	try {
		const posizione = await geocode(db, [bozza.city, 'Italia'].join(', '));
		if (posizione) return { lat: posizione.lat, lon: posizione.lon };
	} catch (err) {
		// Degradazione elegante: senza coordinate restano fuori le regole
		// geografiche, non l'intera anteprima.
		console.error('Geocoding non riuscito durante l’anteprima dei conflitti:', err);
	}
	return { lat: null, lon: null };
}

async function generiDellaBozza(db: Database, bozza: BozzaConflitti) {
	const slugs = [
		...(bozza.primaryGenreSlug ? [bozza.primaryGenreSlug] : []),
		...bozza.secondaryGenreSlugs
	];
	if (!slugs.length) return [];

	const trovati = await db
		.select({ slug: genres.slug, path: genres.path })
		.from(genres)
		.where(inArray(genres.slug, slugs));

	const perSlug = new Map(trovati.map((g) => [g.slug, g.path]));

	return slugs
		.map((slug, i) => {
			const path = perSlug.get(slug);
			return path ? { path, isPrimary: i === 0 } : null;
		})
		.filter((g): g is { path: string; isPrimary: boolean } => g !== null);
}

/**
 * Conflitti che una bozza produrrebbe se venisse salvata così.
 *
 * L'anteprima gira qualunque sia lo stato scelto nel form, bozza compresa:
 * chi sta ancora decidendo è esattamente la persona a cui l'avviso serve. La
 * riconciliazione persistente, invece, ignora le bozze — quella scriverebbe
 * righe che riguardano un'altra organizzazione, e una bozza non deve
 * risultare esistente a nessuno (`partecipaAiConflitti`).
 */
export async function anteprimaConflitti(
	db: Database,
	viewer: ViewerContext,
	bozza: BozzaConflitti
): Promise<EsitoAnteprima> {
	if (!viewer.organizationIds.includes(bozza.organizationId)) {
		return nulla('Puoi controllare solo le date delle organizzazioni di cui fai parte.');
	}
	if (!bozza.startsAtLocal) {
		return nulla('Scegli data e ora d’inizio: è da lì che parte il controllo.');
	}

	const org = await db.query.organizations.findFirst({
		where: eq(organizations.id, bozza.organizationId),
		columns: { defaultConflictRadiusKm: true }
	});
	if (!org) return nulla('Organizzazione non trovata.');

	const venue = bozza.venueId
		? ((await db.query.venues.findFirst({
				where: eq(venues.id, bozza.venueId),
				columns: { lat: true, lon: true }
			})) ?? null)
		: null;

	const coordinate = await coordinateDellaBozza(db, bozza, venue);

	const lineup: VoceLineupPerConflitti[] = bozza.lineup
		.filter((v): v is { artistId: string; isAnnounced: boolean } => v.artistId !== null)
		.map((v) => ({ artistId: v.artistId, isAnnounced: v.isAnnounced }));

	const candidato: EventoPerConflitti = {
		id: bozza.eventId ?? ID_BOZZA,
		organizationId: bozza.organizationId,
		venueId: bozza.venueId,
		startsAt: daLocaleAIstante(bozza.startsAtLocal),
		endsAt: bozza.endsAtLocal ? daLocaleAIstante(bozza.endsAtLocal) : null,
		doorsAt: bozza.doorsAtLocal ? daLocaleAIstante(bozza.doorsAtLocal) : null,
		lat: coordinate.lat,
		lon: coordinate.lon,
		raggioKm: bozza.conflictRadiusKm ?? org.defaultConflictRadiusKm,
		generi: await generiDellaBozza(db, bozza),
		lineup
	};

	const trovati = rilevaConflitti(candidato, await candidati(db, candidato));

	// Nessun conflitto, ma vale la pena dire *perché* il controllo è stato
	// parziale: "non ho trovato niente" e "non ho potuto guardare" si leggono
	// molto diversamente sotto un form.
	const incompleto =
		coordinate.lat === null
			? 'Il luogo non è ancora risolto in coordinate: per ora restano fuori i controlli su distanza e locale.'
			: null;

	if (!trovati.length) return { conflitti: [], incompleto };

	const idControparti = [
		...new Set(trovati.map((c) => (c.eventAId === candidato.id ? c.eventBId : c.eventAId)))
	];
	const controparti = new Map((await caricaEventi(db, idControparti)).map((e) => [e.id, e]));

	const idArtisti = [
		...new Set(trovati.flatMap((c) => (c.dettagli.artisti ?? []).map((a) => a.artistId)))
	];
	const nomi = idArtisti.length
		? Object.fromEntries(
				(
					await db
						.select({ id: artists.id, name: artists.name })
						.from(artists)
						.where(inArray(artists.id, idArtisti))
				).map((a) => [a.id, a.name])
			)
		: {};

	const conflitti: AnteprimaConflitto[] = [];

	for (const c of trovati) {
		const sonoLatoA = c.eventAId === candidato.id;
		const grezzo = controparti.get(sonoLatoA ? c.eventBId : c.eventAId);
		if (!grezzo) continue;

		const controparte = serializeEvent(grezzo, viewer);
		if (!controparte) continue;

		const redazione = redigiConflitto(c.kind, c.dettagli, c.affinita, controparte, sonoLatoA, nomi);
		if (!redazione) continue;

		conflitti.push({
			chiave: `${c.eventAId}|${c.eventBId}|${c.kind}`,
			kind: c.kind,
			severity: c.severity,
			distanzaKm: c.distanzaKm,
			giorniDiDistanza: c.giorniDiDistanza,
			controparte: {
				giorno: controparte.giorno,
				city: controparte.city,
				organizzazione: {
					name: controparte.organizzazione.name,
					emailContact: controparte.organizzazione.emailContact
				}
			},
			artisti: redazione.artisti,
			venue: redazione.venue,
			statoControparte: controparte.status
		});
	}

	return { conflitti, incompleto };
}
