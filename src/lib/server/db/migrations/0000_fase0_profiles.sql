-- Lo schema `auth` è gestito da Supabase, non da noi. Drizzle lo emette perché
-- `profiles.id` ha una foreign key verso `auth.users`: lo rendiamo idempotente
-- così che su Supabase sia un no-op, e che su un Postgres vuoto (test locali)
-- la foreign key resti creabile.
-- Controllare questo punto a ogni `npm run db:generate`: drizzle-kit può
-- riemettere un `CREATE TABLE "auth"."users"` non condizionato.
CREATE SCHEMA IF NOT EXISTS "auth";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth"."users" (
	"id" uuid PRIMARY KEY NOT NULL
);
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
