CREATE TYPE "public"."parse_source" AS ENUM('testo', 'ics', 'csv');--> statement-breakpoint
CREATE TYPE "public"."parse_status" AS ENUM('ok', 'vuoto', 'errore');--> statement-breakpoint
CREATE TABLE "parse_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"raw_text" text NOT NULL,
	"source" "parse_source" NOT NULL,
	"parsed_json" jsonb,
	"model" text,
	"status" "parse_status" NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parse_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "parse_jobs" ADD CONSTRAINT "parse_jobs_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parse_jobs_profile_idx" ON "parse_jobs" USING btree ("profile_id","created_at");