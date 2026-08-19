-- Gli indici trigram in fondo a questo file (artists, venues) non si creano
-- senza pg_trgm. L'estensione è disponibile su Supabase ma non è attiva di
-- default: va abilitata qui, non a mano dal pannello, altrimenti la migrazione
-- non è riproducibile su un database nuovo.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'moderator', 'member');--> statement-breakpoint
CREATE TYPE "public"."org_kind" AS ENUM('club', 'associazione_culturale', 'collettivo', 'promoter', 'festival', 'altro');--> statement-breakpoint
CREATE TABLE "artist_genres" (
	"artist_id" uuid NOT NULL,
	"genre_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "artist_genres_artist_id_genre_id_pk" PRIMARY KEY("artist_id","genre_id")
);
--> statement-breakpoint
ALTER TABLE "artist_genres" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "artists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"mbid" uuid,
	"country" text,
	"city" text,
	"formed_year" integer,
	"bio" text,
	"image_url" text,
	"website_url" text,
	"instagram_url" text,
	"facebook_url" text,
	"bandcamp_url" text,
	"spotify_url" text,
	"youtube_url" text,
	"soundcloud_url" text,
	"booking_email" text,
	"booking_agency" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artists" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "genres" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"path" text NOT NULL,
	"depth" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "genres" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "geocode_cache" (
	"query_normalized" text PRIMARY KEY NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"payload" jsonb,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "geocode_cache" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"organization_id" uuid,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"email_hint" text,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_profile_org_key" UNIQUE("profile_id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" "org_kind" DEFAULT 'altro' NOT NULL,
	"city" text,
	"province" text,
	"region" text,
	"country" text DEFAULT 'IT' NOT NULL,
	"lat" double precision,
	"lon" double precision,
	"website" text,
	"instagram_url" text,
	"facebook_url" text,
	"email_contact" text,
	"default_conflict_radius_km" integer DEFAULT 60 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"address" text,
	"city" text NOT NULL,
	"province" text,
	"region" text,
	"postal_code" text,
	"country" text DEFAULT 'IT' NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"capacity" integer,
	"website" text,
	"instagram_url" text,
	"facebook_url" text,
	"phone" text,
	"email" text,
	"geocode_source" text,
	"geocode_query" text,
	"geocoded_at" timestamp with time zone,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "venues" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "artist_genres" ADD CONSTRAINT "artist_genres_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_genres" ADD CONSTRAINT "artist_genres_genre_id_genres_id_fk" FOREIGN KEY ("genre_id") REFERENCES "public"."genres"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artists" ADD CONSTRAINT "artists_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genres" ADD CONSTRAINT "genres_parent_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."genres"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artist_genres_genre_idx" ON "artist_genres" USING btree ("genre_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artists_mbid_idx" ON "artists" USING btree ("mbid");--> statement-breakpoint
CREATE UNIQUE INDEX "artists_name_normalized_idx" ON "artists" USING btree ("name_normalized") WHERE "artists"."mbid" is null;--> statement-breakpoint
CREATE INDEX "artists_name_trgm_idx" ON "artists" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "genres_slug_idx" ON "genres" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "genres_path_idx" ON "genres" USING btree ("path" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "genres_parent_idx" ON "genres" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invites_code_idx" ON "invites" USING btree ("code");--> statement-breakpoint
CREATE INDEX "memberships_org_idx" ON "memberships" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "venues_name_city_idx" ON "venues" USING btree ("name_normalized","city");--> statement-breakpoint
CREATE INDEX "venues_city_idx" ON "venues" USING btree ("city");--> statement-breakpoint
CREATE INDEX "venues_coords_idx" ON "venues" USING btree ("lat","lon");--> statement-breakpoint
CREATE INDEX "venues_name_trgm_idx" ON "venues" USING gin ("name" gin_trgm_ops);