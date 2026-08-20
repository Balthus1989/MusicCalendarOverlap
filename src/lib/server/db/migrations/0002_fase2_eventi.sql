CREATE TYPE "public"."billing_role" AS ENUM('headliner', 'co_headliner', 'special_guest', 'support', 'opener', 'dj', 'tba');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('draft', 'hold', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_profile_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"diff" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "event_genres" (
	"event_id" uuid NOT NULL,
	"genre_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "event_genres_event_id_genre_id_pk" PRIMARY KEY("event_id","genre_id")
);
--> statement-breakpoint
ALTER TABLE "event_genres" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "event_lineup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"artist_id" uuid,
	"artist_name_raw" text,
	"billing" "billing_role" DEFAULT 'support' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"stage" text,
	"day_date" date,
	"set_starts_at" timestamp with time zone,
	"set_duration_minutes" integer,
	"is_announced" boolean DEFAULT false NOT NULL,
	"notes" text,
	CONSTRAINT "event_lineup_artista_presente" CHECK ("event_lineup"."artist_id" is not null or "event_lineup"."artist_name_raw" is not null)
);
--> statement-breakpoint
ALTER TABLE "event_lineup" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "event_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"venue_id" uuid,
	"status" "event_status" DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"doors_at" timestamp with time zone,
	"is_multi_day" boolean DEFAULT false NOT NULL,
	"city" text NOT NULL,
	"province" text,
	"region" text,
	"country" text DEFAULT 'IT' NOT NULL,
	"lat" double precision,
	"lon" double precision,
	"conflict_radius_km" integer,
	"is_free" boolean DEFAULT false NOT NULL,
	"is_members_only" boolean DEFAULT false NOT NULL,
	"price_presale" numeric(8, 2),
	"price_door" numeric(8, 2),
	"currency" text DEFAULT 'EUR' NOT NULL,
	"ticket_url" text,
	"age_restriction" text,
	"capacity_expected" integer,
	"poster_url" text,
	"facebook_event_url" text,
	"instagram_post_url" text,
	"external_url" text,
	"announce_at" timestamp with time zone,
	"internal_notes" text,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_profile_id_profiles_id_fk" FOREIGN KEY ("actor_profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_genres" ADD CONSTRAINT "event_genres_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_genres" ADD CONSTRAINT "event_genres_genre_id_genres_id_fk" FOREIGN KEY ("genre_id") REFERENCES "public"."genres"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_lineup" ADD CONSTRAINT "event_lineup_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_lineup" ADD CONSTRAINT "event_lineup_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_links" ADD CONSTRAINT "event_links_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_updated_by_profiles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "event_genres_genre_idx" ON "event_genres" USING btree ("genre_id");--> statement-breakpoint
CREATE INDEX "event_lineup_event_idx" ON "event_lineup" USING btree ("event_id","position");--> statement-breakpoint
CREATE INDEX "event_lineup_artist_idx" ON "event_lineup" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "event_links_event_idx" ON "event_links" USING btree ("event_id","sort_order");--> statement-breakpoint
CREATE INDEX "events_starts_at_idx" ON "events" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "events_status_starts_at_idx" ON "events" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "events_org_starts_at_idx" ON "events" USING btree ("organization_id","starts_at");--> statement-breakpoint
CREATE INDEX "events_coords_idx" ON "events" USING btree ("lat","lon");--> statement-breakpoint
CREATE INDEX "events_venue_idx" ON "events" USING btree ("venue_id");