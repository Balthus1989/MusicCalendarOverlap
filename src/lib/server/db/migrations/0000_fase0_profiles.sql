-- Lo schema `auth` è gestito da Supabase e appartiene a `supabase_auth_admin`,
-- non al ruolo `postgres` con cui giriamo le migrazioni. Drizzle emette la
-- creazione di `auth.users` perché `profiles.id` ha una foreign key verso di
-- essa, ma noi non abbiamo il permesso di creare nulla in quello schema — e
-- `CREATE TABLE IF NOT EXISTS` **verifica comunque i permessi**, anche quando
-- la tabella esiste già: fallisce con 42501 invece di essere un no-op.
--
-- Quindi la creazione va saltata del tutto quando la tabella c'è, non solo resa
-- idempotente. Su Supabase il blocco non esegue nulla; su un Postgres vuoto
-- (database di scarto per provare un ripristino) crea il minimo indispensabile
-- perché la foreign key sia formabile.
--
-- Controllare questo punto a ogni `npm run db:generate`: drizzle-kit riemette
-- un `CREATE TABLE "auth"."users"` non condizionato. Vedi ADR-0015.
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'auth' AND tablename = 'users'
	) THEN
		CREATE SCHEMA IF NOT EXISTS "auth";
		CREATE TABLE "auth"."users" ("id" uuid PRIMARY KEY NOT NULL);
	END IF;
END $$;
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- ADR-0003: RLS attiva senza policy = `deny all` per i ruoli non privilegiati.
-- Il server applicativo usa la connessione privilegiata e non ne è soggetto.
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;
