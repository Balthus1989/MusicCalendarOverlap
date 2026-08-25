/**
 * Schema Drizzle — unica fonte di verità dei tipi (ADR-0001).
 *
 * Convenzioni (ARCHITECTURE.md §4):
 * - tutti gli ID sono `uuid` con default `gen_random_uuid()`
 * - tutti i timestamp sono `timestamptz`
 * - timezone applicativo di riferimento: `Europe/Rome`
 *
 * Ogni tabella ha `.enableRLS()`: senza policy equivale a `deny all` per i
 * ruoli non privilegiati (ADR-0003). Il server usa la connessione privilegiata
 * e non ne è soggetto; serve a rendere innocuo un leak della chiave anon.
 *
 * Le migrazioni sono versionate: **mai modificare una migrazione già
 * committata**. Si genera con `npm run db:generate` e si applica con
 * `npm run db:migrate` (connessione diretta, porta 5432).
 */
import { relations, sql } from 'drizzle-orm';
import {
	boolean,
	check,
	date,
	doublePrecision,
	foreignKey,
	index,
	integer,
	jsonb,
	numeric,
	pgEnum,
	pgSchema,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';

/**
 * Riferimento allo schema `auth` gestito da Supabase. Non lo creiamo né lo
 * migriamo noi: serve solo a esprimere la foreign key da `profiles`.
 */
const authSchema = pgSchema('auth');

export const authUsers = authSchema.table('users', {
	id: uuid('id').primaryKey()
});

/* ------------------------------------------------------------------ *
 * Enum
 * ------------------------------------------------------------------ */

export const orgKind = pgEnum('org_kind', [
	'club',
	'associazione_culturale',
	'collettivo',
	'promoter',
	'festival',
	'altro'
]);

/**
 * `owner` e `admin` governano la propria organizzazione. `moderator` è
 * trasversale: corregge e unisce le anagrafiche condivise di artisti e venue,
 * che non appartengono a nessuno (ADR-0016).
 */
export const memberRole = pgEnum('member_role', ['owner', 'admin', 'moderator', 'member']);

/* ------------------------------------------------------------------ *
 * §4.1 Identità e organizzazioni
 * ------------------------------------------------------------------ */

/** Specchio applicativo di `auth.users`. */
export const profiles = pgTable('profiles', {
	id: uuid('id')
		.primaryKey()
		.references(() => authUsers.id, { onDelete: 'cascade' }),
	displayName: text('display_name').notNull(),
	email: text('email').notNull(),
	/** Opzionale, per contatto rapido tra organizzatori. */
	phone: text('phone'),
	/** Genera inviti, gestisce le tassonomie, nomina i moderatori. */
	isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}).enableRLS();

export const organizations = pgTable(
	'organizations',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		name: text('name').notNull(),
		slug: text('slug').notNull(),
		kind: orgKind('kind').notNull().default('altro'),
		city: text('city'),
		province: text('province'),
		region: text('region'),
		country: text('country').notNull().default('IT'),
		/** Base geografica, usata come default per gli eventi. */
		lat: doublePrecision('lat'),
		lon: doublePrecision('lon'),
		website: text('website'),
		instagramUrl: text('instagram_url'),
		facebookUrl: text('facebook_url'),
		emailContact: text('email_contact'),
		/** Preferenza dell'organizzazione, in km (ARCHITECTURE.md §6.2 R3). */
		defaultConflictRadiusKm: integer('default_conflict_radius_km').notNull().default(60),
		notes: text('notes'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [uniqueIndex('organizations_slug_idx').on(t.slug)]
).enableRLS();

/**
 * Un profilo può appartenere a più organizzazioni; il contesto attivo sta in
 * sessione, non qui.
 */
export const memberships = pgTable(
	'memberships',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		profileId: uuid('profile_id')
			.notNull()
			.references(() => profiles.id, { onDelete: 'cascade' }),
		organizationId: uuid('organization_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'cascade' }),
		role: memberRole('role').notNull().default('member'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('memberships_profile_org_key').on(t.profileId, t.organizationId),
		index('memberships_org_idx').on(t.organizationId)
	]
).enableRLS();

/** Registrazione solo su invito (ADR-0004). */
export const invites = pgTable(
	'invites',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		/** Random 10 caratteri URL-safe. */
		code: text('code').notNull(),
		/** Se `NULL`, l'invitato crea una nuova organizzazione. */
		organizationId: uuid('organization_id').references(() => organizations.id, {
			onDelete: 'cascade'
		}),
		role: memberRole('role').notNull().default('member'),
		/** Opzionale, per pre-compilare il form. */
		emailHint: text('email_hint'),
		maxUses: integer('max_uses').notNull().default(1),
		uses: integer('uses').notNull().default(0),
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [uniqueIndex('invites_code_idx').on(t.code)]
).enableRLS();

/* ------------------------------------------------------------------ *
 * §4.2 Tassonomia generi
 * ------------------------------------------------------------------ */

/**
 * Tassonomia chiusa e gerarchica (ADR-0007). Il `path` materializzato
 * (`metal.death-metal.tech-death`) è ciò su cui si calcola l'affinità di
 * genere in Fase 3, tramite prefisso comune.
 */
export const genres = pgTable(
	'genres',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		slug: text('slug').notNull(),
		name: text('name').notNull(),
		parentId: uuid('parent_id'),
		path: text('path').notNull(),
		/** 0 per le radici. */
		depth: integer('depth').notNull(),
		sortOrder: integer('sort_order').notNull().default(0)
	},
	(t) => [
		foreignKey({
			columns: [t.parentId],
			foreignColumns: [t.id],
			name: 'genres_parent_id_fk'
		}).onDelete('restrict'),
		uniqueIndex('genres_slug_idx').on(t.slug),
		// `text_pattern_ops` serve al prefix matching (`path LIKE 'metal.%'`),
		// che l'operator class di default non sa usare fuori dal collation C.
		index('genres_path_idx').using('btree', sql`${t.path} text_pattern_ops`),
		index('genres_parent_idx').on(t.parentId)
	]
).enableRLS();

/* ------------------------------------------------------------------ *
 * §4.3 Artisti e venue
 * ------------------------------------------------------------------ */

/** Anagrafica condivisa: è un bene comune del gruppo (ADR-0006). */
export const artists = pgTable(
	'artists',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		name: text('name').notNull(),
		/** Lowercase, senza accenti né punteggiatura; per la deduplica. */
		nameNormalized: text('name_normalized').notNull(),
		/** MusicBrainz ID: chiave di deduplicazione forte. */
		mbid: uuid('mbid'),
		country: text('country'),
		city: text('city'),
		formedYear: integer('formed_year'),
		/** Markdown breve. */
		bio: text('bio'),
		imageUrl: text('image_url'),
		websiteUrl: text('website_url'),
		instagramUrl: text('instagram_url'),
		facebookUrl: text('facebook_url'),
		bandcampUrl: text('bandcamp_url'),
		spotifyUrl: text('spotify_url'),
		youtubeUrl: text('youtube_url'),
		soundcloudUrl: text('soundcloud_url'),
		/** Informazione preziosa tra organizzatori. */
		bookingEmail: text('booking_email'),
		bookingAgency: text('booking_agency'),
		/** Curato da un admin o da un moderatore. */
		isVerified: boolean('is_verified').notNull().default(false),
		createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		uniqueIndex('artists_mbid_idx').on(t.mbid),
		// Parziale: due band omonime sono legittime se distinte da MBID, ma
		// senza MBID un doppione è quasi sempre un errore di battitura.
		uniqueIndex('artists_name_normalized_idx')
			.on(t.nameNormalized)
			.where(sql`${t.mbid} is null`),
		// Trigram per l'autocomplete locale, prima ancora di interrogare
		// MusicBrainz.
		index('artists_name_trgm_idx').using('gin', sql`${t.name} gin_trgm_ops`)
	]
).enableRLS();

/** Il genere della band è indipendente da quello della serata. */
export const artistGenres = pgTable(
	'artist_genres',
	{
		artistId: uuid('artist_id')
			.notNull()
			.references(() => artists.id, { onDelete: 'cascade' }),
		genreId: uuid('genre_id')
			.notNull()
			.references(() => genres.id, { onDelete: 'cascade' }),
		isPrimary: boolean('is_primary').notNull().default(false)
	},
	(t) => [
		primaryKey({ columns: [t.artistId, t.genreId] }),
		index('artist_genres_genre_idx').on(t.genreId)
	]
).enableRLS();

/** Anche i venue sono condivisi tra le organizzazioni (ADR-0006). */
export const venues = pgTable(
	'venues',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		name: text('name').notNull(),
		nameNormalized: text('name_normalized').notNull(),
		address: text('address'),
		city: text('city').notNull(),
		province: text('province'),
		region: text('region'),
		postalCode: text('postal_code'),
		country: text('country').notNull().default('IT'),
		// NOT NULL: senza coordinate un venue non entra nel calcolo conflitti,
		// e un venue che non entra nel calcolo non serve a niente (ADR-0008).
		lat: doublePrecision('lat').notNull(),
		lon: doublePrecision('lon').notNull(),
		capacity: integer('capacity'),
		website: text('website'),
		instagramUrl: text('instagram_url'),
		facebookUrl: text('facebook_url'),
		phone: text('phone'),
		email: text('email'),
		/** Tracciabilità e cache del geocoding. */
		geocodeSource: text('geocode_source'),
		geocodeQuery: text('geocode_query'),
		geocodedAt: timestamp('geocoded_at', { withTimezone: true }),
		/** Es. "palco piccolo, no backline". */
		notes: text('notes'),
		createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		// Non unique di proposito: stesso nome nella stessa città è quasi
		// sempre un doppione, ma non sempre, e un vincolo che blocca un
		// inserimento legittimo costa più di un doppione da unire. L'indice
		// serve a *avvisare* in fase di inserimento, come i conflitti.
		index('venues_name_city_idx').on(t.nameNormalized, t.city),
		index('venues_city_idx').on(t.city),
		index('venues_coords_idx').on(t.lat, t.lon),
		index('venues_name_trgm_idx').using('gin', sql`${t.name} gin_trgm_ops`)
	]
).enableRLS();

/* ------------------------------------------------------------------ *
 * §4.4 Eventi
 * ------------------------------------------------------------------ */

/**
 * Gli stati dell'evento (ADR-0005). Non sono etichette: sono il meccanismo
 * con cui un organizzatore può caricare una data *prima* di annunciarla.
 * `draft` è privato all'organizzazione, `hold` mostra alle altre solo giorno,
 * città e genere primario, `confirmed` mostra tutto, `cancelled` resta
 * visibile perché liberare uno slot è un'informazione utile agli altri.
 */
export const eventStatus = pgEnum('event_status', ['draft', 'hold', 'confirmed', 'cancelled']);

/** Posizione in locandina. `tba` esiste perché in `hold` spesso è tutto ciò che si sa. */
export const billingRole = pgEnum('billing_role', [
	'headliner',
	'co_headliner',
	'special_guest',
	'support',
	'opener',
	'dj',
	'tba'
]);

export const events = pgTable(
	'events',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		/** Proprietario: è l'asse su cui ruota tutta la matrice di visibilità. */
		organizationId: uuid('organization_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'cascade' }),
		// Nullable di proposito: in `hold` la data è decisa e il locale no.
		// Se il venue fosse obbligatorio, nessuno caricherebbe le date in
		// anticipo — cioè l'unico caso che dà senso al prodotto.
		venueId: uuid('venue_id').references(() => venues.id, { onDelete: 'set null' }),
		status: eventStatus('status').notNull().default('draft'),
		title: text('title').notNull(),
		subtitle: text('subtitle'),
		/** Markdown. */
		description: text('description'),
		startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
		/** Se `NULL` il motore conflitti assume +4h (vedi `DURATA_PREDEFINITA_MS`). */
		endsAt: timestamp('ends_at', { withTimezone: true }),
		doorsAt: timestamp('doors_at', { withTimezone: true }),
		isMultiDay: boolean('is_multi_day').notNull().default(false),
		// Denormalizzati, non ridondanti: un evento in `hold` può non avere
		// ancora un venue, ma la città è nota e il conflitto geografico va
		// calcolato lo stesso (ADR-0008).
		city: text('city').notNull(),
		province: text('province'),
		region: text('region'),
		country: text('country').notNull().default('IT'),
		lat: doublePrecision('lat'),
		lon: doublePrecision('lon'),
		/** Override del raggio dell'organizzazione, in km. */
		conflictRadiusKm: integer('conflict_radius_km'),
		isFree: boolean('is_free').notNull().default(false),
		/** Tesseramento ARCI/ACSI e simili. */
		isMembersOnly: boolean('is_members_only').notNull().default(false),
		pricePresale: numeric('price_presale', { precision: 8, scale: 2 }),
		priceDoor: numeric('price_door', { precision: 8, scale: 2 }),
		currency: text('currency').notNull().default('EUR'),
		ticketUrl: text('ticket_url'),
		ageRestriction: text('age_restriction'),
		capacityExpected: integer('capacity_expected'),
		posterUrl: text('poster_url'),
		facebookEventUrl: text('facebook_event_url'),
		instagramPostUrl: text('instagram_post_url'),
		externalUrl: text('external_url'),
		/** Data prevista di annuncio pubblico; ha senso solo in `hold`. */
		announceAt: timestamp('announce_at', { withTimezone: true }),
		/** **Mai** visibile ad altre organizzazioni, in nessuno stato. */
		internalNotes: text('internal_notes'),
		createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
		updatedBy: uuid('updated_by').references(() => profiles.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('events_starts_at_idx').on(t.startsAt),
		// La selezione dei candidati a conflitto filtra per stato e finestra
		// temporale insieme (ARCHITECTURE.md §6.1).
		index('events_status_starts_at_idx').on(t.status, t.startsAt),
		index('events_org_starts_at_idx').on(t.organizationId, t.startsAt),
		index('events_coords_idx').on(t.lat, t.lon),
		index('events_venue_idx').on(t.venueId)
	]
).enableRLS();

/** Il genere della serata è indipendente da quello delle singole band. */
export const eventGenres = pgTable(
	'event_genres',
	{
		eventId: uuid('event_id')
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		genreId: uuid('genre_id')
			.notNull()
			.references(() => genres.id, { onDelete: 'cascade' }),
		isPrimary: boolean('is_primary').notNull().default(false)
	},
	(t) => [
		primaryKey({ columns: [t.eventId, t.genreId] }),
		index('event_genres_genre_idx').on(t.genreId)
	]
).enableRLS();

export const eventLineup = pgTable(
	'event_lineup',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		eventId: uuid('event_id')
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		/** `NULL` se la band non è ancora in anagrafica, o se è un "TBA". */
		artistId: uuid('artist_id').references(() => artists.id, { onDelete: 'set null' }),
		/** Usato quando `artistId` è `NULL`. */
		artistNameRaw: text('artist_name_raw'),
		billing: billingRole('billing').notNull().default('support'),
		/** Ordine di locandina. */
		position: integer('position').notNull().default(0),
		stage: text('stage'),
		/** Per i festival multi-giorno. */
		dayDate: date('day_date'),
		setStartsAt: timestamp('set_starts_at', { withTimezone: true }),
		setDurationMinutes: integer('set_duration_minutes'),
		// Rivelazione progressiva: una band non annunciata non esce mai da
		// `serializeEvent`, e non deve nemmeno far scattare la regola R2 in
		// modo riconoscibile (ADR-0009).
		isAnnounced: boolean('is_announced').notNull().default(false),
		notes: text('notes')
	},
	(t) => [
		check(
			'event_lineup_artista_presente',
			sql`${t.artistId} is not null or ${t.artistNameRaw} is not null`
		),
		index('event_lineup_event_idx').on(t.eventId, t.position),
		// La regola R2 cerca gli eventi che condividono un artista: senza
		// questo indice diventa una scansione della tabella.
		index('event_lineup_artist_idx').on(t.artistId)
	]
).enableRLS();

/** Link extra oltre a quelli tipizzati su `events`. */
export const eventLinks = pgTable(
	'event_links',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		eventId: uuid('event_id')
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		label: text('label').notNull(),
		url: text('url').notNull(),
		sortOrder: integer('sort_order').notNull().default(0)
	},
	(t) => [index('event_links_event_idx').on(t.eventId, t.sortOrder)]
).enableRLS();

/* ------------------------------------------------------------------ *
 * §4.5 Conflitti
 * ------------------------------------------------------------------ */

/** Le quattro regole di ARCHITECTURE.md §6.2. */
export const conflictKind = pgEnum('conflict_kind', [
	'venue_clash',
	'artist_overlap',
	'geo_genre_overlap',
	'same_day_proximity'
]);

export const conflictSeverity = pgEnum('conflict_severity', ['low', 'medium', 'high']);

/**
 * `open` è appena rilevato, `acknowledged` è "l'abbiamo visto", `resolved` è
 * "non c'è più" (per scelta di qualcuno o perché una delle due date è
 * cambiata), `dismissed` è "lo sappiamo e va bene così".
 */
export const conflictStatus = pgEnum('conflict_status', [
	'open',
	'acknowledged',
	'resolved',
	'dismissed'
]);

/**
 * I conflitti sono **persistiti**, non ricalcolati a ogni vista (ADR-0009).
 *
 * Il motivo non è la prestazione: è che senza storico l'avviso riapparirebbe
 * in eterno anche dopo che i due organizzatori si sono già telefonati e hanno
 * deciso che va bene così. `acknowledged_by_a/b` e `resolution_note` sono il
 * posto dove si legge che quella conversazione è avvenuta.
 *
 * La coppia è ordinata (`event_a_id < event_b_id`, con un CHECK) perché una
 * sovrapposizione fra due date non ha un verso: senza l'ordinamento la stessa
 * situazione entrerebbe due volte, e l'indice unico non servirebbe a niente.
 */
export const conflicts = pgTable(
	'conflicts',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		eventAId: uuid('event_a_id')
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		eventBId: uuid('event_b_id')
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		kind: conflictKind('kind').notNull(),
		severity: conflictSeverity('severity').notNull(),
		distanceKm: numeric('distance_km', { precision: 6, scale: 1 }),
		/** 0.00–1.00, come lo calcola `genre-affinity.ts`. */
		genreAffinity: numeric('genre_affinity', { precision: 3, scale: 2 }),
		/** Giorni civili in `Europe/Rome`, mai millisecondi divisi (ADR-0021). */
		daysApart: integer('days_apart'),
		/**
		 * Artisti condivisi, generi che hanno prodotto l'affinità, minuti di
		 * sovrapposizione. **Contiene dati che non tutti possono vedere**: per
		 * la regola R2 registra anche quali voci di lineup erano annunciate su
		 * ciascun lato, ed è `serializeConflict` a decidere cosa esce
		 * (ADR-0024). Non va mai restituito grezzo.
		 */
		details: jsonb('details'),
		status: conflictStatus('status').notNull().default('open'),
		acknowledgedByA: boolean('acknowledged_by_a').notNull().default(false),
		acknowledgedByB: boolean('acknowledged_by_b').notNull().default(false),
		resolutionNote: text('resolution_note'),
		/**
		 * `NULL` distingue la risoluzione automatica — il conflitto è sparito
		 * perché una data è cambiata — da quella scritta da una persona. Serve
		 * al ricalcolo: il primo caso si riapre se il conflitto ritorna, il
		 * secondo no.
		 */
		resolvedBy: uuid('resolved_by').references(() => profiles.id, { onDelete: 'set null' }),
		computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		// L'ordinamento della coppia è un invariante del dato, non una
		// convenzione del codice: qui il database lo fa rispettare.
		check('conflicts_coppia_ordinata', sql`${t.eventAId} < ${t.eventBId}`),
		unique('conflicts_coppia_kind_key').on(t.eventAId, t.eventBId, t.kind),
		index('conflicts_event_a_idx').on(t.eventAId),
		index('conflicts_event_b_idx').on(t.eventBId),
		// La dashboard chiede sempre "cosa è aperto, dal più grave": è la sola
		// query che gira su questa tabella con una certa frequenza.
		index('conflicts_status_idx').on(t.status, t.severity)
	]
).enableRLS();

/* ------------------------------------------------------------------ *
 * §4.6 Supporto
 * ------------------------------------------------------------------ */

/**
 * Feed ICS sottoscrivibili (ARCHITECTURE.md §8, ADR-0011).
 *
 * Il `token` è un segreto in un URL: l'endpoint che serve il feed è pubblico,
 * perché i client calendario non fanno login. Da lì tre conseguenze che sono
 * parte del dato e non del codice:
 *
 * - il feed appartiene a un **profilo**, non a un'organizzazione, ed è quel
 *   profilo il viewer con cui `serializeEvent` redige il contenuto: chi entra
 *   in possesso del token vede esattamente ciò che vedrebbe quella persona
 *   facendo login, mai di più;
 * - `revoked_at` esiste perché un segreto che non si può ritirare non è un
 *   segreto: un URL finito in una chat va disattivato senza toccare gli altri
 *   feed della stessa persona;
 * - `last_accessed_at` è l'unico modo per accorgersi che un feed non lo
 *   interroga più nessuno, o che ne interroga uno che non si ricordava di aver
 *   creato.
 */
export const calendarFeeds = pgTable(
	'calendar_feeds',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		/** Random 32 caratteri URL-safe, generato con un CSPRNG. */
		token: text('token').notNull(),
		profileId: uuid('profile_id')
			.notNull()
			.references(() => profiles.id, { onDelete: 'cascade' }),
		/** Nome dato dall'utente: si finisce ad averne più d'uno. */
		label: text('label').notNull(),
		/**
		 * `{ generi, stati, organizzazioni, raggioKm, centro }`, come lo
		 * descrive `FiltriFeed` in `$lib/schemas/feed.ts`. È un filtro, non un
		 * permesso: restringe ciò che il profilo già vede, non lo allarga mai.
		 */
		filters: jsonb('filters'),
		lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		uniqueIndex('calendar_feeds_token_idx').on(t.token),
		index('calendar_feeds_profile_idx').on(t.profileId, t.createdAt)
	]
).enableRLS();

/**
 * Cache dei risultati di geocoding. Photon e Nominatim hanno rate limit
 * stretti e una policy d'uso da rispettare: ogni query risolta si tiene.
 */
export const geocodeCache = pgTable('geocode_cache', {
	queryNormalized: text('query_normalized').primaryKey(),
	lat: doublePrecision('lat').notNull(),
	lon: doublePrecision('lon').notNull(),
	payload: jsonb('payload'),
	source: text('source').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}).enableRLS();

export const parseSource = pgEnum('parse_source', ['testo', 'ics', 'csv']);

export const parseStatus = pgEnum('parse_status', ['ok', 'vuoto', 'errore']);

/**
 * Registro degli incolla passati dal parser (ARCHITECTURE.md §9).
 *
 * Serve a due cose, entrambe scritte nella specifica: **debug** — quando
 * qualcuno dice "me l'ha compilato male" la domanda è cosa aveva incollato — e
 * **misura della qualità dell'estrazione**, che senza il testo di partenza
 * accanto al risultato non si può calcolare.
 *
 * Un job non è mai un evento: nessuna riga qui dentro diventa una data senza
 * che una persona abbia rivisto e salvato il form ([ADR-0031](../../../../docs/DECISIONS.md)).
 *
 * `raw_text` è testo che l'utente ha copiato da altrove e può contenere dati
 * personali di terzi — un numero di telefono nella locandina, il nome di chi
 * gestisce le prenotazioni. Ha quindi una **scadenza**, non una vita
 * indefinita: il ricalcolo notturno cancella i job più vecchi di 90 giorni
 * ([ADR-0032](../../../../docs/DECISIONS.md)).
 */
export const parseJobs = pgTable(
	'parse_jobs',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		profileId: uuid('profile_id')
			.notNull()
			.references(() => profiles.id, { onDelete: 'cascade' }),
		/** Il testo incollato, così com'era. Cancellato dopo 90 giorni. */
		rawText: text('raw_text').notNull(),
		/** Come è stato letto: `ics` e `csv` non passano da nessun modello. */
		source: parseSource('source').notNull(),
		/** Il risultato conforme a `bersaglioParse`, prima della revisione umana. */
		parsedJson: jsonb('parsed_json'),
		/** `null` per le sorgenti deterministiche: non c'è nessun modello di mezzo. */
		model: text('model'),
		status: parseStatus('status').notNull(),
		/** Perché è andata male, in chiaro: serve a chi legge il registro, non all'utente. */
		error: text('error'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('parse_jobs_profile_idx').on(t.profileId, t.createdAt)]
).enableRLS();

/**
 * Traccia di chi ha cambiato cosa. Serve soprattutto sugli eventi: quando due
 * organizzatori si accorgono che una data è cambiata sotto i piedi, la domanda
 * è sempre "chi e quando", e senza registro la risposta non esiste.
 *
 * Non è una tabella di sicurezza: nessuno ci costruisce sopra un permesso.
 */
export const auditLog = pgTable(
	'audit_log',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		actorProfileId: uuid('actor_profile_id').references(() => profiles.id, {
			onDelete: 'set null'
		}),
		/** `event`, `conflict`, `membership`. */
		entityType: text('entity_type').notNull(),
		entityId: uuid('entity_id').notNull(),
		/** `create`, `update`, `status_change`, `delete`. */
		action: text('action').notNull(),
		/** Solo i campi cambiati: `{ campo: [prima, dopo] }`. */
		diff: jsonb('diff'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('audit_log_entity_idx').on(t.entityType, t.entityId, t.createdAt)]
).enableRLS();

/**
 * Contatori di rate limit (ARCHITECTURE.md §16, ADR-0037).
 *
 * Una riga per finestra e per soggetto: la chiave contiene già la risorsa,
 * l'identità e l'inizio della finestra, quindi incrementare è un `INSERT … ON
 * CONFLICT DO UPDATE` che torna il conteggio aggiornato — atomico, senza
 * leggere-poi-scrivere.
 *
 * Sta nel database e non in memoria per la stessa ragione di [ADR-0034](../../../../docs/DECISIONS.md):
 * su Cloudflare gli isolate vanno e vengono, e un limite che si azzera a ogni
 * risveglio non è un limite. Le righe scadute le porta via `/api/cron/purge`.
 */
export const rateLimits = pgTable(
	'rate_limits',
	{
		/** `risorsa:identità:inizioFinestra`. Vedi `chiaveFinestra()`. */
		bucket: text('bucket').primaryKey(),
		hits: integer('hits').notNull().default(0),
		/** Quando la riga smette di servire a qualcosa. */
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
	},
	(t) => [index('rate_limits_expires_idx').on(t.expiresAt)]
).enableRLS();

/* ------------------------------------------------------------------ *
 * §4.6 Notifiche (Fase 6)
 * ------------------------------------------------------------------ */

/**
 * I cinque motivi per cui il calendario si fa vivo (ARCHITECTURE.md §10).
 *
 * Sono un enum e non un `text` libero perché ognuno ha un canale diverso e
 * una preferenza diversa: un motivo scritto a mano che nessuno ha previsto
 * finirebbe fuori da entrambe le tabelle di decisione.
 */
export const notificationKind = pgEnum('notification_kind', [
	'conflitto_nuovo',
	'conflitto_risolto',
	'invito',
	'digest_settimanale',
	'sollecito_annuncio'
]);

/**
 * Le notifiche ricevute da un profilo: in pagina, e fuori dall'applicazione
 * sul canale configurato.
 *
 * La riga è **già redatta**: `payload` contiene il testo come lo vedrà questo
 * destinatario e nient'altro, perché la redazione dipende da chi guarda e
 * ricalcolarla al momento della lettura vorrebbe dire rifarla in due posti
 * ([ADR-0035](../../../../docs/DECISIONS.md)). Un conflitto che a questo
 * profilo non si può raccontare non produce nessuna riga qui dentro.
 *
 * La tabella è anche la **coda di uscita**: `consegna_richiesta` dice che una
 * copia fuori dall'applicazione era prevista, `consegnata_at` che è partita.
 * Le due cose insieme fanno un elenco di consegne dovute e mai riuscite, che
 * la corsa notturna ritenta ([ADR-0036](../../../../docs/DECISIONS.md)).
 */
export const notifications = pgTable(
	'notifications',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		profileId: uuid('profile_id')
			.notNull()
			.references(() => profiles.id, { onDelete: 'cascade' }),
		kind: notificationKind('kind').notNull(),
		/** Titolo, testo e link, già redatti per questo destinatario. */
		payload: jsonb('payload').notNull(),
		/**
		 * Chiave di identità dell'avviso, per non ripeterlo.
		 *
		 * Il sollecito di annuncio si valuta ogni notte sulla stessa data, e il
		 * digest ogni lunedì: senza una chiave, la seconda esecuzione dello
		 * stesso giorno manderebbe tutto due volte. `null` per gli avvisi che
		 * nascono da un fatto puntuale e non si ripetono da sé.
		 */
		dedupeKey: text('dedupe_key'),
		/**
		 * Una copia **fuori dall'applicazione** era prevista da §10 e non
		 * rifiutata nelle preferenze.
		 *
		 * Le colonne non nominano il canale di proposito: fino alla Fase 6 era
		 * l'email, adesso è Telegram, e il layer è costruito perché possa
		 * essere un altro ancora senza toccare niente qui
		 * ([ADR-0039](../../../../docs/DECISIONS.md)).
		 */
		consegnaRichiesta: boolean('consegna_richiesta').notNull().default(false),
		consegnataAt: timestamp('consegnata_at', { withTimezone: true }),
		/** Perché non è partita: serve al manutentore, non all'utente. */
		erroreConsegna: text('errore_consegna'),
		readAt: timestamp('read_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('notifications_profile_idx').on(t.profileId, t.createdAt),
		uniqueIndex('notifications_dedupe_idx').on(t.profileId, t.dedupeKey),
		// Le consegne dovute e mai riuscite. Parziale perché è l'unica riga che
		// la corsa notturna cerca, e a regime sono zero.
		index('notifications_da_consegnare_idx')
			.on(t.createdAt)
			.where(sql`${t.consegnaRichiesta} and ${t.consegnataAt} is null`)
	]
).enableRLS();

/**
 * Quali avvisi un profilo accetta di ricevere **fuori dall'applicazione**.
 *
 * I nomi non citano il canale: governano la consegna, qualunque essa sia. Fino
 * alla Fase 6 era l'email, adesso è Telegram
 * ([ADR-0039](../../../../docs/DECISIONS.md)).
 *
 * L'assenza di riga vale "tutto acceso": un profilo appena creato deve essere
 * avvisato di un conflitto grave, e farlo dipendere da una riga che qualcuno
 * si è dimenticato di inserire sarebbe un silenzio per errore.
 *
 * Non c'è un interruttore per le notifiche in pagina: quelle non arrivano
 * addosso a nessuno, si leggono quando si apre la casella. Nemmeno per
 * l'invito, che arriva a chi non ha ancora un profilo su cui esprimere una
 * preferenza — ed è anche il motivo per cui l'invito non ha nessun canale
 * esterno possibile, e il suo link si passa a mano.
 */
export const notificationPrefs = pgTable('notification_prefs', {
	profileId: uuid('profile_id')
		.primaryKey()
		.references(() => profiles.id, { onDelete: 'cascade' }),
	/** Conflitti nuovi di severity `medium` o `high`. */
	avvisaConflitti: boolean('avvisa_conflitti').notNull().default(true),
	/** Il riepilogo del lunedì mattina. */
	avvisaDigest: boolean('avvisa_digest').notNull().default(true),
	/** Il promemoria su una data opzionata che avrebbe dovuto essere annunciata. */
	avvisaSolleciti: boolean('avvisa_solleciti').notNull().default(true),

	/**
	 * La chat di Telegram su cui consegnare, quando il profilo l'ha collegata.
	 *
	 * `NULL` significa "non collegato", e vuol dire che gli avvisi restano solo
	 * in pagina: non è un errore né uno stato da riparare, è la condizione
	 * predefinita di chiunque non abbia fatto niente.
	 *
	 * È l'unica colonna di questa tabella che nomina un canale, e sta qui e non
	 * su `profiles` perché è configurazione di notifica, non identità.
	 */
	telegramChatId: text('telegram_chat_id'),
	/**
	 * Il codice usa-e-getta con cui si collega la chat.
	 *
	 * Chi vuole collegarsi lo manda al bot; l'applicazione poi lo ricerca fra i
	 * messaggi ricevuti e ne ricava la chat. Sparisce appena il collegamento
	 * riesce, e scade da solo (`telegram_token_at`).
	 */
	telegramToken: text('telegram_token'),
	telegramTokenAt: timestamp('telegram_token_at', { withTimezone: true }),

	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}).enableRLS();

/* ------------------------------------------------------------------ *
 * Relazioni
 * ------------------------------------------------------------------ */

export const profilesRelations = relations(profiles, ({ many }) => ({
	memberships: many(memberships)
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
	memberships: many(memberships),
	invites: many(invites)
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
	profile: one(profiles, { fields: [memberships.profileId], references: [profiles.id] }),
	organization: one(organizations, {
		fields: [memberships.organizationId],
		references: [organizations.id]
	})
}));

export const invitesRelations = relations(invites, ({ one }) => ({
	organization: one(organizations, {
		fields: [invites.organizationId],
		references: [organizations.id]
	}),
	createdByProfile: one(profiles, { fields: [invites.createdBy], references: [profiles.id] })
}));

export const genresRelations = relations(genres, ({ one, many }) => ({
	parent: one(genres, { fields: [genres.parentId], references: [genres.id], relationName: 'tree' }),
	children: many(genres, { relationName: 'tree' }),
	artistGenres: many(artistGenres)
}));

export const artistsRelations = relations(artists, ({ many }) => ({
	artistGenres: many(artistGenres)
}));

export const artistGenresRelations = relations(artistGenres, ({ one }) => ({
	artist: one(artists, { fields: [artistGenres.artistId], references: [artists.id] }),
	genre: one(genres, { fields: [artistGenres.genreId], references: [genres.id] })
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
	organization: one(organizations, {
		fields: [events.organizationId],
		references: [organizations.id]
	}),
	venue: one(venues, { fields: [events.venueId], references: [venues.id] }),
	eventGenres: many(eventGenres),
	lineup: many(eventLineup),
	links: many(eventLinks)
}));

export const eventGenresRelations = relations(eventGenres, ({ one }) => ({
	event: one(events, { fields: [eventGenres.eventId], references: [events.id] }),
	genre: one(genres, { fields: [eventGenres.genreId], references: [genres.id] })
}));

export const eventLineupRelations = relations(eventLineup, ({ one }) => ({
	event: one(events, { fields: [eventLineup.eventId], references: [events.id] }),
	artist: one(artists, { fields: [eventLineup.artistId], references: [artists.id] })
}));

export const eventLinksRelations = relations(eventLinks, ({ one }) => ({
	event: one(events, { fields: [eventLinks.eventId], references: [events.id] })
}));

/**
 * Le due relazioni hanno nomi diversi perché puntano alla stessa tabella:
 * senza, Drizzle non saprebbe quale delle due foreign key seguire.
 */
export const conflictsRelations = relations(conflicts, ({ one }) => ({
	eventA: one(events, {
		fields: [conflicts.eventAId],
		references: [events.id],
		relationName: 'conflitto_evento_a'
	}),
	eventB: one(events, {
		fields: [conflicts.eventBId],
		references: [events.id],
		relationName: 'conflitto_evento_b'
	})
}));

/* ------------------------------------------------------------------ *
 * Tipi
 * ------------------------------------------------------------------ */

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
export type MemberRole = (typeof memberRole.enumValues)[number];
export type OrgKind = (typeof orgKind.enumValues)[number];
export type Invite = typeof invites.$inferSelect;
export type Genre = typeof genres.$inferSelect;
export type NewGenre = typeof genres.$inferInsert;
export type Artist = typeof artists.$inferSelect;
export type NewArtist = typeof artists.$inferInsert;
export type Venue = typeof venues.$inferSelect;
export type NewVenue = typeof venues.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type EventStatus = (typeof eventStatus.enumValues)[number];
export type BillingRole = (typeof billingRole.enumValues)[number];
export type EventGenre = typeof eventGenres.$inferSelect;
export type EventLineupRow = typeof eventLineup.$inferSelect;
export type NewEventLineupRow = typeof eventLineup.$inferInsert;
export type EventLink = typeof eventLinks.$inferSelect;
export type CalendarFeed = typeof calendarFeeds.$inferSelect;
export type NewCalendarFeed = typeof calendarFeeds.$inferInsert;
export type Conflict = typeof conflicts.$inferSelect;
export type NewConflict = typeof conflicts.$inferInsert;
export type ConflictKind = (typeof conflictKind.enumValues)[number];
export type ConflictSeverity = (typeof conflictSeverity.enumValues)[number];
export type ConflictStatus = (typeof conflictStatus.enumValues)[number];
export type AuditLogRow = typeof auditLog.$inferSelect;
export type ParseJob = typeof parseJobs.$inferSelect;
export type NewParseJob = typeof parseJobs.$inferInsert;
export type ParseSource = (typeof parseSource.enumValues)[number];
export type ParseStatus = (typeof parseStatus.enumValues)[number];
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type NotificationKind = (typeof notificationKind.enumValues)[number];
export type NotificationPrefs = typeof notificationPrefs.$inferSelect;
export type RateLimit = typeof rateLimits.$inferSelect;
