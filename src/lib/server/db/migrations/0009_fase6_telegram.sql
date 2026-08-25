ALTER TABLE "notification_prefs" ADD COLUMN "telegram_chat_id" text;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN "telegram_token" text;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN "telegram_token_at" timestamp with time zone;