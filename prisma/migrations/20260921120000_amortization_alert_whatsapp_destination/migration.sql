-- AlterEnum: add whatsapp channel (PG 15+ IF NOT EXISTS; PG 12+ ok inside txn)
ALTER TYPE "amortization_alert_channel" ADD VALUE IF NOT EXISTS 'whatsapp';

-- Add destination column (Telegram rows keep '')
ALTER TABLE "amortization_alert_deliveries"
  ADD COLUMN IF NOT EXISTS "destination" TEXT NOT NULL DEFAULT '';

-- Replace unique (reference_date, channel) → (reference_date, channel, destination)
DROP INDEX IF EXISTS "amortization_alert_deliveries_reference_date_channel_key";

CREATE UNIQUE INDEX IF NOT EXISTS "amortization_alert_deliveries_reference_date_channel_destination_key"
  ON "amortization_alert_deliveries"("reference_date", "channel", "destination");
