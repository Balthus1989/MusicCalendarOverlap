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
	doublePrecision,
	foreignKey,
	index,
	integer,
	jsonb,
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
 * §4.6 Supporto
 * ------------------------------------------------------------------ */

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
