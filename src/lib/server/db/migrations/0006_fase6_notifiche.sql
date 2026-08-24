CREATE TYPE "public"."notification_kind" AS ENUM('conflitto_nuovo', 'conflitto_risolto', 'invito', 'digest_settimanale', 'sollecito_annuncio');--> statement-breakpoint
CREATE TABLE "notification_prefs" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"email_conflitti" boolean DEFAULT true NOT NULL,
	"email_digest" boolean DEFAULT true NOT NULL,
	"email_solleciti" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_prefs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" text,
	"email_requested" boolean DEFAULT false NOT NULL,
	"emailed_at" timestamp with time zone,
	"email_error" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_profile_idx" ON "notifications" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_idx" ON "notifications" USING btree ("profile_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_da_spedire_idx" ON "notifications" USING btree ("created_at") WHERE "notifications"."email_requested" and "notifications"."emailed_at" is null;