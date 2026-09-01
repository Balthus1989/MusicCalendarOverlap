/**
 * I dati su cui girano gli smoke test, e i due modi per metterli e toglierli.
 *
 * **Toccano un database vero.** Non c'è un ambiente di prova separato: il free
 * tier di Supabase ne dà uno, e il progetto ha un manutentore part-time
 * (ADR-0013). Tutto quello che questi test creano porta quindi il prefisso
 * `e2e-`, e il progetto `pulisci` di Playwright lo rimuove alla fine — anche
 * quando i test falliscono.
 *
 * Il prefisso non è cosmetico: è ciò che permette alla pulizia di essere
 * chirurgica invece che un `truncate`, e quindi di lanciare i test contro il
 * database di sviluppo del manutentore senza portargli via i dati di demo.
 */
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { and, eq, inArray, like } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
	artists,
	calendarFeeds,
	eventGenres,
	eventLineup,
	events,
	genres,
	memberships,
	organizations,
	profiles,
	venues
} from '../../src/lib/server/db/schema.ts';
import { normalizeName } from '../../src/lib/server/text.ts';
import { daLocaleAIstante } from '../../src/lib/time.ts';

export const PREFISSO = 'e2e-';

/** Gli id seminati, scritti dalla preparazione e riletti dai test. */
export const FILE_AMBIENTE = 'tests/e2e/.auth/ambiente.json';

export function leggiAmbiente(): Ambiente {
	return JSON.parse(readFileSync(FILE_AMBIENTE, 'utf8')) as Ambiente;
}

export const ALFA = {
	email: 'e2e-alfa@calendario.test',
	nome: 'Alfa E2E',
	orgSlug: 'e2e-circolo-alfa',
	orgNome: 'E2E Circolo Alfa',
	statoFile: 'tests/e2e/.auth/alfa.json'
};

export const BETA = {
	email: 'e2e-beta@calendario.test',
	nome: 'Beta E2E',
	orgSlug: 'e2e-circolo-beta',
	orgNome: 'E2E Circolo Beta',
	statoFile: 'tests/e2e/.auth/beta.json'
};

/**
 * La sera del conflitto.
 *
 * Sessanta giorni avanti: dentro la finestra del ricalcolo (diciotto mesi) e
 * lontana da qualunque data dei dati di demo, così un conflitto che compare è
 * per forza quello costruito qui.
 */
export function seraDelConflitto(): string {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() + 60);
	return d.toISOString().slice(0, 10);
}

export const ORA_ALFA = '22:00';
export const ORA_BETA = '21:30';

/** Il genere condiviso: due serate metal la stessa sera, a pochi chilometri. */
export const GENERE = 'death-metal';

/**
 * Due locali a Perugia, a poche centinaia di metri.
 *
 * Le coordinate sono vere perché sono l'unica parte che conta: su quelle il
 * motore calcola la distanza, ed è la distanza a far scattare la regola.
 */
export const LOCALE_ALFA = {
	name: 'E2E Sala Alfa',
	city: 'Perugia',
	province: 'PG',
	address: 'Via Alfa 1',
	lat: 43.1107,
	lon: 12.3908
};

export const LOCALE_BETA = {
	name: 'E2E Sala Beta',
	city: 'Perugia',
	province: 'PG',
	address: 'Via Beta 2',
	lat: 43.1181,
	lon: 12.3862
};

export const TITOLO_BETA = 'E2E Serata Beta';
export const TITOLO_ALFA = 'E2E Serata Alfa';

/**
 * Le due band di Beta: una annunciata, una no.
 *
 * La seconda è il motivo per cui esiste tutto il layer di visibilità. Nessuna
 * uscita del prodotto — pagina, feed, export, email — deve contenere il suo
 * nome per chi non è di Beta, e finché è così lo stato `hold` mantiene la sua
 * promessa (ADR-0005, ADR-0020).
 */
export const BAND_ANNUNCIATA = 'E2E Band Annunciata';
export const BAND_SEGRETA = 'E2E Band Riservata';

/**
 * La band che **tutte e due** le organizzazioni hanno ospitato, ognuna su una
 * propria data già passata.
 *
 * Esiste per una cosa sola: provare la soglia della scheda operativa contro un
 * database vero. Con una sola organizzazione non compare niente; con due
 * compare un intervallo che non dice da che parte sta ciascun estremo
 * (ADR-0049).
 */
export const BAND_COMUNE = 'E2E Band Comune';

export const TITOLO_PASSATA_ALFA = 'E2E Passata Alfa';
export const TITOLO_PASSATA_ALFA_2 = 'E2E Passata Alfa Due';
export const TITOLO_PASSATA_BETA = 'E2E Passata Beta';

/**
 * Una sera già passata, trenta giorni indietro: un'osservazione si scrive solo
 * su una data passata e ancora `confirmed` (ADR-0048).
 */
export function seraPassata(): string {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() - 30);
	return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ *
 * Connessioni
 * ------------------------------------------------------------------ */

export type Db = PostgresJsDatabase<Record<string, never>>;

export function apriDb() {
	const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL o DIRECT_DATABASE_URL mancante: vedi .env.example.');
	const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10 });
	return { sql, db: drizzle(sql) as unknown as Db };
}

export function apriAdmin(): SupabaseClient {
	const url = process.env.PUBLIC_SUPABASE_URL;
	const chiave = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !chiave) {
		throw new Error(
			'PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY mancanti: gli smoke test hanno bisogno del ruolo di servizio per creare gli utenti di prova.'
		);
	}
	return createClient(url, chiave, { auth: { persistSession: false, autoRefreshToken: false } });
}

/* ------------------------------------------------------------------ *
 * Utenti
 * ------------------------------------------------------------------ */

async function trovaUtente(admin: SupabaseClient, email: string) {
	// `listUsers` pagina a cinquanta: a questi volumi una pagina basta, e su un
	// progetto con più utenti il filtro per email risparmia il giro.
	const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
	if (error) throw error;
	return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

/** Crea l'utente di prova se non c'è, con l'email già confermata. */
export async function assicuraUtente(admin: SupabaseClient, email: string, nome: string) {
	const gia = await trovaUtente(admin, email);
	if (gia) return gia;

	const { data, error } = await admin.auth.admin.createUser({
		email,
		email_confirm: true,
		user_metadata: { display_name: nome }
	});
	if (error) throw error;
	return data.user;
}

/**
 * Il `token_hash` da appendere a `/auth/callback`.
 *
 * È la stessa cosa che finirebbe nell'email: il test entra dalla porta da cui
 * entra un utente vero, e non da una scorciatoia che inietta cookie a mano.
 * Se il flusso di login si rompe, questi test se ne accorgono.
 */
export async function tokenDiAccesso(admin: SupabaseClient, email: string): Promise<string> {
	const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
	if (error) throw error;
	const hash = data.properties?.hashed_token;
	if (!hash) throw new Error(`Nessun token generato per ${email}.`);
	return hash;
}

/* ------------------------------------------------------------------ *
 * Dati di dominio
 * ------------------------------------------------------------------ */

async function idProfilo(db: Db, email: string): Promise<string> {
	const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.email, email));
	if (!p) {
		throw new Error(
			`Profilo mancante per ${email}. Il profilo nasce al primo accesso: il login deve venire prima della semina.`
		);
	}
	return p.id;
}

async function assicuraOrganizzazione(db: Db, slug: string, name: string): Promise<string> {
	const [gia] = await db
		.select({ id: organizations.id })
		.from(organizations)
		.where(eq(organizations.slug, slug));
	if (gia) return gia.id;

	const [creata] = await db
		.insert(organizations)
		.values({
			name,
			slug,
			kind: 'associazione_culturale',
			city: 'Perugia',
			province: 'PG',
			region: 'Umbria',
			lat: 43.1107,
			lon: 12.3908,
			emailContact: `${slug}@calendario.test`
		})
		.returning({ id: organizations.id });
	return creata.id;
}

async function assicuraLocale(db: Db, dati: typeof LOCALE_ALFA, createdBy: string) {
	const nameNormalized = normalizeName(dati.name);
	const [gia] = await db
		.select({ id: venues.id })
		.from(venues)
		.where(and(eq(venues.nameNormalized, nameNormalized), eq(venues.city, dati.city)));
	if (gia) return gia.id;

	const [creato] = await db
		.insert(venues)
		.values({
			...dati,
			nameNormalized,
			country: 'IT',
			geocodeSource: 'e2e',
			geocodedAt: new Date(),
			createdBy
		})
		.returning({ id: venues.id });
	return creato.id;
}

export type Ambiente = {
	profiloAlfa: string;
	profiloBeta: string;
	orgAlfa: string;
	orgBeta: string;
	localeAlfa: string;
	localeBeta: string;
	eventoBeta: string;
	giorno: string;
	/** Le due date già passate, una per organizzazione, con la stessa band. */
	passataAlfa: string;
	passataAlfa2: string;
	passataBeta: string;
	bandComune: string;
	giornoPassato: string;
};

/**
 * Mette in piedi il mondo dei test: due organizzazioni, due locali vicini, e
 * **una sola data già esistente** — quella di Beta, confermata. La data di
 * Alfa la crea il test dall'interfaccia, perché è quella la cosa da provare.
 */
export async function seminaAmbiente(db: Db): Promise<Ambiente> {
	const profiloAlfa = await idProfilo(db, ALFA.email);
	const profiloBeta = await idProfilo(db, BETA.email);

	const orgAlfa = await assicuraOrganizzazione(db, ALFA.orgSlug, ALFA.orgNome);
	const orgBeta = await assicuraOrganizzazione(db, BETA.orgSlug, BETA.orgNome);

	await db
		.insert(memberships)
		.values([
			{ profileId: profiloAlfa, organizationId: orgAlfa, role: 'owner' },
			{ profileId: profiloBeta, organizationId: orgBeta, role: 'owner' }
		])
		.onConflictDoNothing();

	const localeAlfa = await assicuraLocale(db, LOCALE_ALFA, profiloAlfa);
	const localeBeta = await assicuraLocale(db, LOCALE_BETA, profiloBeta);

	const giorno = seraDelConflitto();

	const [genere] = await db.select({ id: genres.id }).from(genres).where(eq(genres.slug, GENERE));
	if (!genere) {
		throw new Error(
			`Genere "${GENERE}" assente: la tassonomia non è stata seminata. Lancia "npm run db:seed".`
		);
	}

	let [eventoBeta] = await db
		.select({ id: events.id })
		.from(events)
		.where(and(eq(events.organizationId, orgBeta), eq(events.title, TITOLO_BETA)));

	if (!eventoBeta) {
		[eventoBeta] = await db
			.insert(events)
			.values({
				organizationId: orgBeta,
				venueId: localeBeta,
				status: 'confirmed',
				title: TITOLO_BETA,
				startsAt: daLocaleAIstante(`${giorno}T${ORA_BETA}`),
				city: LOCALE_BETA.city,
				province: LOCALE_BETA.province,
				region: 'Umbria',
				country: 'IT',
				lat: LOCALE_BETA.lat,
				lon: LOCALE_BETA.lon,
				isFree: false,
				currency: 'EUR',
				createdBy: profiloBeta,
				updatedBy: profiloBeta
			})
			.returning({ id: events.id });

		await db
			.insert(eventGenres)
			.values({ eventId: eventoBeta.id, genreId: genere.id, isPrimary: true })
			.onConflictDoNothing();
	}

	// La lineup di Beta: una band annunciata e una no. È il caso che tutte le
	// uscite del prodotto devono trattare bene.
	const lineupGia = await db
		.select({ id: eventLineup.id })
		.from(eventLineup)
		.where(eq(eventLineup.eventId, eventoBeta.id));

	if (!lineupGia.length) {
		const idBand: string[] = [];
		for (const nome of [BAND_ANNUNCIATA, BAND_SEGRETA]) {
			const nameNormalized = normalizeName(nome);
			const [gia] = await db
				.select({ id: artists.id })
				.from(artists)
				.where(eq(artists.nameNormalized, nameNormalized));
			if (gia) {
				idBand.push(gia.id);
				continue;
			}
			const [creato] = await db
				.insert(artists)
				.values({ name: nome, nameNormalized, createdBy: profiloBeta })
				.returning({ id: artists.id });
			idBand.push(creato.id);
		}

		await db.insert(eventLineup).values([
			{
				eventId: eventoBeta.id,
				artistId: idBand[0],
				artistNameRaw: BAND_ANNUNCIATA,
				billing: 'headliner',
				position: 0,
				isAnnounced: true
			},
			{
				eventId: eventoBeta.id,
				artistId: idBand[1],
				artistNameRaw: BAND_SEGRETA,
				billing: 'support',
				position: 1,
				isAnnounced: false
			}
		]);
	}

	/*
	 * Le due date già passate, una per organizzazione, con la stessa band in
	 * cartellone. Servono alla scheda operativa (Fase 7): la soglia di ADR-0049
	 * chiede due osservazioni da **due organizzazioni distinte**, e un ambiente
	 * con una sola organizzazione non saprebbe distinguere una soglia che
	 * funziona da una che non è mai stata raggiunta.
	 */
	const giornoPassato = seraPassata();
	const bandComune = await assicuraBand(db, BAND_COMUNE, profiloAlfa);

	const passataAlfa = await assicuraDataPassata(db, {
		titolo: TITOLO_PASSATA_ALFA,
		organizationId: orgAlfa,
		venueId: localeAlfa,
		locale: LOCALE_ALFA,
		giorno: giornoPassato,
		profiloId: profiloAlfa,
		artistId: bandComune
	});

	// Due date di Alfa e una di Beta: tre osservazioni da due organizzazioni,
	// che è il minimo perché la fascia comune compaia. Con due sole — una per
	// parte — l'aggregato sarebbe invertibile da tutte e due, ed è il motivo
	// per cui la soglia è a tre (correzione di ADR-0049).
	const passataAlfa2 = await assicuraDataPassata(db, {
		titolo: TITOLO_PASSATA_ALFA_2,
		organizationId: orgAlfa,
		venueId: localeAlfa,
		locale: LOCALE_ALFA,
		giorno: giornoPassato,
		profiloId: profiloAlfa,
		artistId: bandComune
	});

	const passataBeta = await assicuraDataPassata(db, {
		titolo: TITOLO_PASSATA_BETA,
		organizationId: orgBeta,
		venueId: localeBeta,
		locale: LOCALE_BETA,
		giorno: giornoPassato,
		profiloId: profiloBeta,
		artistId: bandComune
	});

	return {
		profiloAlfa,
		profiloBeta,
		orgAlfa,
		orgBeta,
		localeAlfa,
		localeBeta,
		eventoBeta: eventoBeta.id,
		giorno,
		passataAlfa,
		passataAlfa2,
		passataBeta,
		bandComune,
		giornoPassato
	};
}

/** Una band in anagrafica, creata una volta sola. */
async function assicuraBand(db: Db, nome: string, createdBy: string): Promise<string> {
	const nameNormalized = normalizeName(nome);
	const [gia] = await db
		.select({ id: artists.id })
		.from(artists)
		.where(eq(artists.nameNormalized, nameNormalized));
	if (gia) return gia.id;

	const [creata] = await db
		.insert(artists)
		.values({ name: nome, nameNormalized, createdBy })
		.returning({ id: artists.id });
	return creata.id;
}

/**
 * Una data passata e confermata, con una band sola in cartellone.
 *
 * Passata e `confirmed` non sono dettagli dell'ambiente: sono le due
 * condizioni che rendono scrivibile un'osservazione, e se una delle due
 * cadesse il riquadro «com'è andata?» non comparirebbe affatto.
 */
async function assicuraDataPassata(
	db: Db,
	d: {
		titolo: string;
		organizationId: string;
		venueId: string;
		locale: typeof LOCALE_ALFA;
		giorno: string;
		profiloId: string;
		artistId: string;
	}
): Promise<string> {
	const [gia] = await db
		.select({ id: events.id })
		.from(events)
		.where(and(eq(events.organizationId, d.organizationId), eq(events.title, d.titolo)));
	if (gia) return gia.id;

	const [creato] = await db
		.insert(events)
		.values({
			organizationId: d.organizationId,
			venueId: d.venueId,
			status: 'confirmed',
			title: d.titolo,
			startsAt: daLocaleAIstante(`${d.giorno}T21:00`),
			city: d.locale.city,
			province: d.locale.province,
			region: 'Umbria',
			country: 'IT',
			lat: d.locale.lat,
			lon: d.locale.lon,
			isFree: false,
			currency: 'EUR',
			createdBy: d.profiloId,
			updatedBy: d.profiloId
		})
		.returning({ id: events.id });

	await db.insert(eventLineup).values({
		eventId: creato.id,
		artistId: d.artistId,
		artistNameRaw: BAND_COMUNE,
		billing: 'headliner',
		position: 0,
		isAnnounced: true
	});

	return creato.id;
}

/* ------------------------------------------------------------------ *
 * Pulizia
 * ------------------------------------------------------------------ */

/**
 * Toglie tutto quello che i test hanno messo.
 *
 * L'ordine conta solo in parte — eventi, lineup e conflitti se ne vanno in
 * cascata dalle organizzazioni — ma cancellare esplicitamente rende leggibile
 * che cosa questi test toccano davvero.
 *
 * Gli utenti di `auth.users` si cancellano per ultimi: da lì cade in cascata
 * il profilo, e con il profilo i feed e le notifiche.
 */
export async function pulisciAmbiente(db: Db, admin: SupabaseClient) {
	const orgIds = (
		await db
			.select({ id: organizations.id })
			.from(organizations)
			.where(like(organizations.slug, `${PREFISSO}%`))
	).map((o) => o.id);

	if (orgIds.length) {
		await db.delete(events).where(inArray(events.organizationId, orgIds));
		await db.delete(memberships).where(inArray(memberships.organizationId, orgIds));
		await db.delete(organizations).where(inArray(organizations.id, orgIds));
	}

	await db.delete(venues).where(like(venues.name, 'E2E %'));
	await db.delete(artists).where(like(artists.name, 'E2E %'));

	for (const email of [ALFA.email, BETA.email]) {
		const [p] = await db
			.select({ id: profiles.id })
			.from(profiles)
			.where(eq(profiles.email, email));
		if (p) await db.delete(calendarFeeds).where(eq(calendarFeeds.profileId, p.id));

		const utente = await trovaUtente(admin, email);
		if (utente) await admin.auth.admin.deleteUser(utente.id);
	}
}
