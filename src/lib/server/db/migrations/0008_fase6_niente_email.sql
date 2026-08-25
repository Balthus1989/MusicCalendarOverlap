-- L'email smette di essere il canale delle notifiche (ADR-0039).
--
-- Sono **rinomine**, non colonne buttate e rifatte: le righe in coda restano
-- in coda e cambiano solo nome, che è ciò che serve perché il canale nuovo le
-- riprenda da dove l'email le aveva lasciate.
--
-- I nomi nuovi non citano nessun canale. È il punto: fino a qui era la posta,
-- da qui è Telegram, e la volta dopo potrebbe essere altro senza che questa
-- tabella se ne accorga.
--
-- Scritta a mano invece che generata. `drizzle-kit generate` davanti a tre
-- colonne tolte e tre aggiunte nella stessa tabella non può sapere da solo se
-- sia una rinomina o una sostituzione, e lo chiede a chi sta al terminale: la
-- risposta qui cambia i dati, quindi è scritta nel file invece che data a voce.
ALTER TABLE "notifications" RENAME COLUMN "email_requested" TO "consegna_richiesta";--> statement-breakpoint
ALTER TABLE "notifications" RENAME COLUMN "emailed_at" TO "consegnata_at";--> statement-breakpoint
ALTER TABLE "notifications" RENAME COLUMN "email_error" TO "errore_consegna";--> statement-breakpoint
ALTER TABLE "notification_prefs" RENAME COLUMN "email_conflitti" TO "avvisa_conflitti";--> statement-breakpoint
ALTER TABLE "notification_prefs" RENAME COLUMN "email_digest" TO "avvisa_digest";--> statement-breakpoint
ALTER TABLE "notification_prefs" RENAME COLUMN "email_solleciti" TO "avvisa_solleciti";--> statement-breakpoint
-- L'indice parziale va rifatto e non rinominato: la sua clausola `WHERE`
-- nomina le colonne, e un `ALTER INDEX ... RENAME` lascerebbe dentro il testo
-- vecchio.
DROP INDEX IF EXISTS "notifications_da_spedire_idx";--> statement-breakpoint
CREATE INDEX "notifications_da_consegnare_idx" ON "notifications" USING btree ("created_at") WHERE "notifications"."consegna_richiesta" and "notifications"."consegnata_at" is null;
