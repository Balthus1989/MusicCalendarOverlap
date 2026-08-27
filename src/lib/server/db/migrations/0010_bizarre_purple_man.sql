ALTER TYPE "public"."notification_kind" ADD VALUE 'segnalazione_esterna';--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "segnalata_da_organization_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "esterna" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_segnalata_da_organization_id_organizations_id_fk" FOREIGN KEY ("segnalata_da_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_segnalate_solo_pubbliche" CHECK ("events"."segnalata_da_organization_id" is null or "events"."status" in ('confirmed', 'cancelled'));