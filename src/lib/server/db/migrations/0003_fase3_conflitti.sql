CREATE TYPE "public"."conflict_kind" AS ENUM('venue_clash', 'artist_overlap', 'geo_genre_overlap', 'same_day_proximity');--> statement-breakpoint
CREATE TYPE "public"."conflict_severity" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."conflict_status" AS ENUM('open', 'acknowledged', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TABLE "conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_a_id" uuid NOT NULL,
	"event_b_id" uuid NOT NULL,
	"kind" "conflict_kind" NOT NULL,
	"severity" "conflict_severity" NOT NULL,
	"distance_km" numeric(6, 1),
	"genre_affinity" numeric(3, 2),
	"days_apart" integer,
	"details" jsonb,
	"status" "conflict_status" DEFAULT 'open' NOT NULL,
	"acknowledged_by_a" boolean DEFAULT false NOT NULL,
	"acknowledged_by_b" boolean DEFAULT false NOT NULL,
	"resolution_note" text,
	"resolved_by" uuid,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conflicts_coppia_kind_key" UNIQUE("event_a_id","event_b_id","kind"),
	CONSTRAINT "conflicts_coppia_ordinata" CHECK ("conflicts"."event_a_id" < "conflicts"."event_b_id")
);
--> statement-breakpoint
ALTER TABLE "conflicts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_event_a_id_events_id_fk" FOREIGN KEY ("event_a_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_event_b_id_events_id_fk" FOREIGN KEY ("event_b_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_resolved_by_profiles_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conflicts_event_a_idx" ON "conflicts" USING btree ("event_a_id");--> statement-breakpoint
CREATE INDEX "conflicts_event_b_idx" ON "conflicts" USING btree ("event_b_id");--> statement-breakpoint
CREATE INDEX "conflicts_status_idx" ON "conflicts" USING btree ("status","severity");