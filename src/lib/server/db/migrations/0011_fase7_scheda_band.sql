CREATE TYPE "public"."cachet_band" AS ENUM('fino_a_300', '300_600', '600_1200', '1200_2500', '2500_5000', 'oltre_5000');--> statement-breakpoint
CREATE TYPE "public"."cachet_scope" AS ENUM('solo_cachet', 'cachet_e_viaggio', 'tutto_incluso');--> statement-breakpoint
CREATE TYPE "public"."observation_origin" AS ENUM('osservata', 'riferita');--> statement-breakpoint
CREATE TYPE "public"."volume_attrezzatura" AS ENUM('solo_voce', 'acustico', 'backline_leggera', 'furgone', 'furgone_grande', 'camion');--> statement-breakpoint
CREATE TABLE "artist_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artist_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by" uuid,
	"origine" "observation_origin" NOT NULL,
	"event_lineup_id" uuid,
	"fascia_cachet" "cachet_band",
	"cachet_include" "cachet_scope",
	"durata_set_minuti" integer,
	"volume_osservato" "volume_attrezzatura",
	"data_riferimento" date NOT NULL,
	"ruolo" "billing_role",
	"capienza_venue" integer,
	"regione" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artist_observations_ancoraggio" CHECK (("artist_observations"."origine" = 'osservata') = ("artist_observations"."event_lineup_id" is not null)),
	CONSTRAINT "artist_observations_almeno_un_dato" CHECK ("artist_observations"."fascia_cachet" is not null or "artist_observations"."durata_set_minuti" is not null or "artist_observations"."volume_osservato" is not null)
);
--> statement-breakpoint
ALTER TABLE "artist_observations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN "volume_attrezzatura" "volume_attrezzatura";--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN "persone_in_viaggio" integer;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN "richiede_backline" boolean;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN "durata_set_max_dichiarata" integer;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN "scheda_spenta" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "artist_observations" ADD CONSTRAINT "artist_observations_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_observations" ADD CONSTRAINT "artist_observations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_observations" ADD CONSTRAINT "artist_observations_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_observations" ADD CONSTRAINT "artist_observations_event_lineup_id_event_lineup_id_fk" FOREIGN KEY ("event_lineup_id") REFERENCES "public"."event_lineup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artist_observations_lineup_idx" ON "artist_observations" USING btree ("event_lineup_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artist_observations_riferita_idx" ON "artist_observations" USING btree ("artist_id","organization_id") WHERE "artist_observations"."origine" = 'riferita';--> statement-breakpoint
CREATE INDEX "artist_observations_artist_idx" ON "artist_observations" USING btree ("artist_id","data_riferimento");