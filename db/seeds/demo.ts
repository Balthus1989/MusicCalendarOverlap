/**
 * Dati di prova per lo sviluppo — **non** un seed di produzione.
 *
 *   npm run db:seed:demo
 *
 * Differenza da `run.ts`: quello allinea la tassonomia dei generi, che è dato
 * di dominio e va applicata ovunque (ADR-0007). Questo popola un database di
 * sviluppo con qualcosa su cui cliccare. Non va mai lanciato in produzione.
 *
 * **Nomi inventati, coordinate vere.** Le anagrafiche di questo prodotto
 * conterranno contatti di persone reali (`booking_email`, telefoni), e finché
 * non è deciso chi è titolare del trattamento — decisione #5 del registro — i
 * dati di prova non devono essere quelli di organizzatori veri. Le coordinate
 * invece sono autentiche, perché sono l'unica parte che conta davvero: su
 * quelle si calcolano le distanze del motore conflitti.
 *
 * La geografia è quella dell'Alta Valle del Tevere, attorno alla prima
 * organizzazione iscritta: c'è chi sta dentro il raggio predefinito e chi ne
 * sta fuori, che è esattamente il caso interessante.
 *
 * Idempotente: si può rilanciare senza creare doppioni.
 */
import 'dotenv/config';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
	artistGenres,
	artists,
	eventGenres,
	eventLineup,
	events,
	genres,
	organizations,
	profiles,
	venues
} from '../../src/lib/server/db/schema.ts';
import { normalizeName } from '../../src/lib/server/text.ts';
import { daLocaleAIstante } from '../../src/lib/time.ts';

/* ------------------------------------------------------------------ *
 * Connessione
 * ------------------------------------------------------------------ */

// Come i seed veri, si preferisce la connessione diretta. Ma l'host diretto di
// Supabase risponde solo su IPv6: da una rete che non ce l'ha, non risolve
// affatto. Per dei dati di prova non vale la pena fermarsi, quindi si ripiega
// sul pooler dicendolo.
const diretta = process.env.DIRECT_DATABASE_URL;
const pooler = process.env.DATABASE_URL;

async function apri() {
	for (const [nome, url] of [
		['connessione diretta', diretta],
		['pooler', pooler]
	] as const) {
		if (!url) continue;
		const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 8 });
		try {
			await sql`select 1`;
			console.log(`Connesso via ${nome}.`);
			return sql;
		} catch (err) {
			console.warn(`${nome} non disponibile: ${err instanceof Error ? err.message : err}`);
			await sql.end({ timeout: 2 }).catch(() => {});
		}
	}
	throw new Error('Nessuna connessione disponibile: controlla DATABASE_URL e DIRECT_DATABASE_URL.');
}

/* ------------------------------------------------------------------ *
 * I dati
 * ------------------------------------------------------------------ */

const ORGANIZZAZIONI = [
	{
		name: 'Circolo Arci Lupo Bianco',
		slug: 'circolo-arci-lupo-bianco',
		kind: 'associazione_culturale' as const,
		city: 'Città di Castello',
		province: 'PG',
		region: 'Umbria',
		// Una dozzina di chilometri da Sansepolcro: dentro qualunque raggio
		// ragionevole, quindi la controparte naturale di ogni conflitto.
		lat: 43.5528,
		lon: 12.2381,
		emailContact: 'lupobianco@example.org',
		defaultConflictRadiusKm: 40
	},
	{
		name: 'Collettivo Fuori Orario',
		slug: 'collettivo-fuori-orario',
		kind: 'collettivo' as const,
		city: 'Perugia',
		province: 'PG',
		region: 'Umbria',
		// Una cinquantina di chilometri: fuori dal raggio di 30 km della prima
		// organizzazione, dentro il proprio di 60. Serve a vedere che il raggio
		// effettivo è il minimo fra i due, non il massimo.
		lat: 43.1107,
		lon: 12.3908,
		emailContact: 'fuoriorario@example.org',
		defaultConflictRadiusKm: 60
	}
];

const LOCALI = [
	{
		name: 'Sala Borgo Rosso',
		city: 'Città di Castello',
		province: 'PG',
		region: 'Umbria',
		address: 'Via del Popolo 12',
		lat: 43.5528,
		lon: 12.2381,
		capacity: 200,
		notes: 'Palco stretto, niente backline. Carico e scarico dal cortile.'
	},
	{
		name: 'Ex Fornace di Anghiari',
		city: 'Anghiari',
		province: 'AR',
		region: 'Toscana',
		address: 'Località Fornace 3',
		lat: 43.5417,
		lon: 12.0575,
		capacity: 120,
		notes: 'Spazio estivo, agibilità solo fino a mezzanotte.'
	},
	{
		name: 'Auditorium del Verzaro',
		city: 'Perugia',
		province: 'PG',
		region: 'Umbria',
		address: 'Via del Verzaro 45',
		lat: 43.1107,
		lon: 12.3908,
		capacity: 350,
		notes: 'Buon impianto, service interno obbligatorio.'
	}
];

/** Il primo slug è il genere primario, come ovunque nel progetto. */
const ARTISTI = [
	{
		name: 'Mandrie Elettriche',
		country: 'IT',
		city: 'Arezzo',
		formedYear: 2016,
		bio: 'Stoner strumentale con lunghe code rumorose.',
		generi: ['stoner', 'sludge']
	},
	{
		name: 'Vespro Nero',
		country: 'IT',
		city: 'Perugia',
		formedYear: 2009,
		bio: 'Black metal di scuola umbra, testi in italiano.',
		generi: ['black-metal', 'doom']
	},
	{
		name: 'Trio Ostinato',
		country: 'IT',
		city: 'Città di Castello',
		formedYear: 2019,
		bio: 'Jazz da camera che scivola spesso nell’improvvisazione libera.',
		generi: ['jazz', 'free-jazz']
	},
	{
		name: 'Bassa Marea',
		country: 'IT',
		city: 'Sansepolcro',
		formedYear: 2021,
		bio: 'Canzone d’autore con strumenti acustici e qualche pedale di troppo.',
		generi: ['cantautorale-italiano', 'folk']
	}
];

/**
 * Le date di prova.
 *
 * Non sono casuali: servono a vedere la matrice di §5 senza un secondo
 * account, e a lasciare pronta in Fase 3 una coppia che fa scattare le regole
 * sui conflitti.
 *
 * Il perno è il **12 settembre**. Quel giorno ci sono tre serate: una
 * opzionata a Città di Castello, una confermata a Perugia che condivide la
 * band con la prima, e una opzionata a Sansepolcro. È il caso che in Fase 3
 * deve produrre un conflitto di artista (R2) e uno geografico (R3) — e che
 * deve farlo **senza** nominare i Vespro Nero, perché nell'evento opzionato
 * quella band non è annunciata (ADR-0009).
 */
type LineupProva = {
	/** Nome in anagrafica: se combacia, la riga viene collegata alla scheda. */
	artista?: string;
	/** Testo libero, per chi in anagrafica non c'è. */
	nome?: string;
	billing: 'headliner' | 'co_headliner' | 'special_guest' | 'support' | 'opener' | 'dj' | 'tba';
	annunciata: boolean;
	set?: string;
};

const EVENTI: Array<{
	org: string;
	status: 'draft' | 'hold' | 'confirmed' | 'cancelled';
	title: string;
	subtitle?: string;
	description?: string;
	inizio: string;
	fine?: string;
	porte?: string;
	annuncio?: string;
	locale?: string;
	city: string;
	province: string;
	region: string;
	lat: number;
	lon: number;
	generi: string[];
	lineup: LineupProva[];
	gratuito?: boolean;
	tesserati?: boolean;
	prevendita?: string;
	porta?: string;
	noteInterne?: string;
}> = [
	{
		// IL CASO CHE CONTA: opzionato, di un'altra organizzazione. Chi guarda
		// dal Cinghiale Marcio deve vedere soltanto "12 settembre — Città di
		// Castello (PG) — Metal — Circolo Arci Lupo Bianco".
		org: 'circolo-arci-lupo-bianco',
		status: 'hold',
		title: 'Notte Nera in Valtiberina',
		subtitle: 'terza edizione',
		description: 'Due band, un cortile, nessuna transenna.',
		inizio: '2026-09-12T22:00',
		fine: '2026-09-13T02:00',
		porte: '2026-09-12T21:00',
		annuncio: '2026-09-01T09:00',
		// Niente locale: è il caso che dà senso a `hold`, e la città regge
		// comunque il calcolo geografico.
		city: 'Città di Castello',
		province: 'PG',
		region: 'Umbria',
		lat: 43.5528,
		lon: 12.2381,
		generi: ['metal', 'black-metal'],
		lineup: [
			// Non annunciata: non deve uscire da nessuna parte, e in Fase 3 il
			// messaggio di conflitto non deve nominarla.
			{ artista: 'Vespro Nero', billing: 'headliner', annunciata: false },
			{ nome: 'Ospite da annunciare', billing: 'tba', annunciata: false }
		],
		noteInterne: 'Cachet 900 € più vitto. Confermare il service entro il 20 agosto.'
	},
	{
		org: 'circolo-arci-lupo-bianco',
		status: 'confirmed',
		title: 'Polvere e Fuzz',
		description: 'Stoner strumentale, ingresso con tessera.',
		inizio: '2026-08-29T21:30',
		fine: '2026-08-30T00:30',
		porte: '2026-08-29T20:30',
		locale: 'Sala Borgo Rosso',
		city: 'Città di Castello',
		province: 'PG',
		region: 'Umbria',
		lat: 43.5528,
		lon: 12.2381,
		generi: ['stoner', 'sludge'],
		lineup: [
			{
				artista: 'Mandrie Elettriche',
				billing: 'headliner',
				annunciata: true,
				set: '2026-08-29T23:00'
			},
			// Annunciata a metà: da fuori l'organizzazione questa riga non si
			// vede, pur essendo l'evento `confirmed`.
			{ artista: 'Bassa Marea', billing: 'support', annunciata: false }
		],
		tesserati: true,
		prevendita: '10.00',
		porta: '13.00',
		noteInterne: 'Pagamento in contanti a fine serata.'
	},
	{
		org: 'circolo-arci-lupo-bianco',
		status: 'cancelled',
		title: 'Jazz alla Fornace',
		description: 'Annullata per allerta meteo.',
		inizio: '2026-09-05T21:00',
		fine: '2026-09-05T23:30',
		locale: 'Ex Fornace di Anghiari',
		city: 'Anghiari',
		province: 'AR',
		region: 'Toscana',
		lat: 43.5417,
		lon: 12.0575,
		generi: ['jazz', 'free-jazz'],
		lineup: [{ artista: 'Trio Ostinato', billing: 'headliner', annunciata: true }],
		gratuito: true
	},
	{
		// Bozza altrui: non deve comparire affatto nel calendario.
		org: 'circolo-arci-lupo-bianco',
		status: 'draft',
		title: 'Idea per fine settembre',
		inizio: '2026-09-19T22:00',
		city: 'Città di Castello',
		province: 'PG',
		region: 'Umbria',
		lat: 43.5528,
		lon: 12.2381,
		generi: ['punk-hardcore'],
		lineup: [],
		noteInterne: 'Se salta la data del 12, si sposta qui.'
	},
	{
		// Stesso giorno del `hold`, stessa band, 55 km di distanza: la coppia
		// che in Fase 3 deve far scattare R2 e R3.
		org: 'collettivo-fuori-orario',
		status: 'confirmed',
		title: 'Rito Notturno',
		inizio: '2026-09-12T22:00',
		fine: '2026-09-13T01:30',
		porte: '2026-09-12T21:30',
		locale: 'Auditorium del Verzaro',
		city: 'Perugia',
		province: 'PG',
		region: 'Umbria',
		lat: 43.1107,
		lon: 12.3908,
		generi: ['black-metal', 'doom'],
		lineup: [{ artista: 'Vespro Nero', billing: 'headliner', annunciata: true }],
		prevendita: '15.00',
		porta: '18.00'
	},
	{
		// La tua, per confronto: sullo stesso giorno, e visibile per intero
		// note interne e band non annunciata comprese.
		org: 'il-cinghiale-marcio',
		status: 'hold',
		title: 'Serata Bassa Marea',
		inizio: '2026-09-12T21:30',
		fine: '2026-09-12T23:59',
		annuncio: '2026-08-28T10:00',
		city: 'Sansepolcro',
		province: 'AR',
		region: 'Toscana',
		lat: 43.5700776,
		lon: 12.1403766,
		generi: ['cantautorale', 'cantautorale-italiano'],
		lineup: [{ artista: 'Bassa Marea', billing: 'headliner', annunciata: false }],
		noteInterne: 'Chiedere a Bassa Marea se portano loro il service.'
	}
];

/* ------------------------------------------------------------------ *
 * Inserimento
 * ------------------------------------------------------------------ */

const sql = await apri();
const db = drizzle(sql);

try {
	// Le schede di anagrafica hanno un autore: si attribuiscono al primo
	// profilo esistente, così `canEditCatalogEntry` si comporta come in un
	// database vero invece che trattarle come orfane.
	const [autore] = await db.select({ id: profiles.id }).from(profiles).limit(1);
	const createdBy = autore?.id ?? null;
	if (!createdBy) {
		console.warn('Nessun profilo in tabella: le schede risulteranno senza autore.');
	}

	/* Organizzazioni ------------------------------------------------- */
	let orgNuove = 0;
	for (const o of ORGANIZZAZIONI) {
		const inserita = await db
			.insert(organizations)
			.values(o)
			.onConflictDoNothing({ target: organizations.slug })
			.returning({ id: organizations.id });
		if (inserita.length) orgNuove++;
	}
	console.log(
		`Organizzazioni: ${orgNuove} nuove, ${ORGANIZZAZIONI.length - orgNuove} già presenti.`
	);

	/* Locali ---------------------------------------------------------- */
	// `venues` non ha un indice unico di proposito (vedi lo schema): il
	// controllo di esistenza va fatto qui.
	let localiNuovi = 0;
	for (const v of LOCALI) {
		const nameNormalized = normalizeName(v.name);
		const esistente = await db
			.select({ id: venues.id })
			.from(venues)
			.where(and(eq(venues.nameNormalized, nameNormalized), eq(venues.city, v.city)))
			.limit(1);
		if (esistente.length) continue;

		await db.insert(venues).values({
			...v,
			nameNormalized,
			country: 'IT',
			geocodeSource: 'seed-demo',
			geocodeQuery: `${v.address}, ${v.city}`,
			geocodedAt: new Date(),
			createdBy
		});
		localiNuovi++;
	}
	console.log(`Locali: ${localiNuovi} nuovi, ${LOCALI.length - localiNuovi} già presenti.`);

	/* Artisti e generi ------------------------------------------------ */
	const slugUsati = [...new Set(ARTISTI.flatMap((a) => a.generi))];
	const generiTrovati = await db
		.select({ id: genres.id, slug: genres.slug })
		.from(genres)
		.where(inArray(genres.slug, slugUsati));
	const idPerSlug = new Map(generiTrovati.map((g) => [g.slug, g.id]));

	const mancanti = slugUsati.filter((s) => !idPerSlug.has(s));
	if (mancanti.length) {
		throw new Error(`Generi non trovati: ${mancanti.join(', ')}. Lancia prima "npm run db:seed".`);
	}

	let artistiNuovi = 0;
	for (const a of ARTISTI) {
		const nameNormalized = normalizeName(a.name);
		let [scheda] = await db
			.select({ id: artists.id })
			.from(artists)
			.where(eq(artists.nameNormalized, nameNormalized))
			.limit(1);

		if (!scheda) {
			[scheda] = await db
				.insert(artists)
				.values({
					name: a.name,
					nameNormalized,
					country: a.country,
					city: a.city,
					formedYear: a.formedYear,
					bio: a.bio,
					createdBy
				})
				.returning({ id: artists.id });
			artistiNuovi++;
		}

		await db
			.insert(artistGenres)
			.values(
				a.generi.map((slug, i) => ({
					artistId: scheda.id,
					genreId: idPerSlug.get(slug)!,
					isPrimary: i === 0
				}))
			)
			.onConflictDoNothing();
	}
	console.log(`Artisti: ${artistiNuovi} nuovi, ${ARTISTI.length - artistiNuovi} già presenti.`);

	/* Eventi ---------------------------------------------------------- */
	const orgPerSlug = new Map(
		(await db.select({ id: organizations.id, slug: organizations.slug }).from(organizations)).map(
			(o) => [o.slug, o.id]
		)
	);
	const localePerNome = new Map(
		(
			await db
				.select({ id: venues.id, name: venues.name, lat: venues.lat, lon: venues.lon })
				.from(venues)
		).map((v) => [v.name, v])
	);
	const artistaPerNome = new Map(
		(await db.select({ id: artists.id, name: artists.name }).from(artists)).map((a) => [
			a.name,
			a.id
		])
	);

	const slugGeneriEventi = [...new Set(EVENTI.flatMap((e) => e.generi))];
	const generiEventi = await db
		.select({ id: genres.id, slug: genres.slug })
		.from(genres)
		.where(inArray(genres.slug, slugGeneriEventi));
	const idGenerePerSlug = new Map(generiEventi.map((g) => [g.slug, g.id]));

	let eventiNuovi = 0;
	for (const e of EVENTI) {
		const organizationId = orgPerSlug.get(e.org);
		if (!organizationId) throw new Error(`Organizzazione "${e.org}" non trovata.`);

		// Nessuna chiave naturale su `events`: per l'idempotenza basta la
		// coppia organizzazione + titolo, che in dati di prova è unica.
		const gia = await db
			.select({ id: events.id })
			.from(events)
			.where(and(eq(events.organizationId, organizationId), eq(events.title, e.title)))
			.limit(1);
		if (gia.length) continue;

		const locale = e.locale ? localePerNome.get(e.locale) : undefined;
		if (e.locale && !locale) throw new Error(`Locale "${e.locale}" non trovato.`);

		const [creato] = await db
			.insert(events)
			.values({
				organizationId,
				venueId: locale?.id ?? null,
				status: e.status,
				title: e.title,
				subtitle: e.subtitle ?? null,
				description: e.description ?? null,
				startsAt: daLocaleAIstante(e.inizio),
				endsAt: e.fine ? daLocaleAIstante(e.fine) : null,
				doorsAt: e.porte ? daLocaleAIstante(e.porte) : null,
				announceAt: e.annuncio ? daLocaleAIstante(e.annuncio) : null,
				city: e.city,
				province: e.province,
				region: e.region,
				country: 'IT',
				// Dal locale se c'è, altrimenti dalla città: è la regola di
				// ADR-0008, e un evento in `hold` senza locale deve comunque
				// entrare nei calcoli geografici.
				lat: locale?.lat ?? e.lat,
				lon: locale?.lon ?? e.lon,
				isFree: e.gratuito ?? false,
				isMembersOnly: e.tesserati ?? false,
				pricePresale: e.prevendita ?? null,
				priceDoor: e.porta ?? null,
				currency: 'EUR',
				internalNotes: e.noteInterne ?? null,
				createdBy,
				updatedBy: createdBy
			})
			.returning({ id: events.id });

		await db.insert(eventGenres).values(
			e.generi.map((slug, i) => ({
				eventId: creato.id,
				genreId: idGenerePerSlug.get(slug)!,
				isPrimary: i === 0
			}))
		);

		if (e.lineup.length) {
			await db.insert(eventLineup).values(
				e.lineup.map((v, i) => {
					const artistId = v.artista ? (artistaPerNome.get(v.artista) ?? null) : null;
					return {
						eventId: creato.id,
						artistId,
						artistNameRaw: artistId ? null : (v.nome ?? v.artista ?? 'TBA'),
						billing: v.billing,
						position: i,
						isAnnounced: v.annunciata,
						setStartsAt: v.set ? daLocaleAIstante(v.set) : null
					};
				})
			);
		}

		eventiNuovi++;
	}
	console.log(`Eventi: ${eventiNuovi} nuovi, ${EVENTI.length - eventiNuovi} già presenti.`);

	console.log('\nDati di prova pronti.');
} catch (err) {
	console.error('Seed di prova fallito:', err);
	process.exitCode = 1;
} finally {
	await sql.end();
}
