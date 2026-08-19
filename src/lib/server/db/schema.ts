/**
 * Schema Drizzle — unica fonte di verità dei tipi (ADR-0001).
 *
 * Convenzioni (ARCHITECTURE.md §4):
 * - tutti gli ID sono `uuid` con default `gen_random_uuid()`
 * - tutti i timestamp sono `timestamptz`
 * - timezone applicativo di riferimento: `Europe/Rome`
 *
 * Le migrazioni sono versionate: **mai modificare una migrazione già
 * committata**. Si genera con `npm run db:generate` e si applica con
 * `npm run db:migrate` (connessione diretta, porta 5432).
 */
import { boolean, pgSchema, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Riferimento allo schema `auth` gestito da Supabase. Non lo creiamo né lo
 * migriamo noi: serve solo a esprimere la foreign key da `profiles`.
 */
const authSchema = pgSchema('auth');

export const authUsers = authSchema.table('users', {
	id: uuid('id').primaryKey()
});

/**
 * Specchio applicativo di `auth.users` (ARCHITECTURE.md §4.1).
 *
 * `.enableRLS()` senza policy = `deny all` per i ruoli non privilegiati: è la
 * difesa in profondità richiesta da ADR-0003. Il server applicativo usa la
 * connessione privilegiata e non è soggetto a RLS; la policy serve solo a
 * rendere innocuo un eventuale leak della chiave anon.
 */
export const profiles = pgTable('profiles', {
	id: uuid('id')
		.primaryKey()
		.references(() => authUsers.id, { onDelete: 'cascade' }),
	displayName: text('display_name').notNull(),
	email: text('email').notNull(),
	/** Opzionale, per contatto rapido tra organizzatori. */
	phone: text('phone'),
	/** Genera inviti e gestisce le tassonomie. */
	isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}).enableRLS();

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
