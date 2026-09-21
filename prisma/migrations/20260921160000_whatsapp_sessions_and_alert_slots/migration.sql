-- Slot for multi-reminder idempotency (D-1 / D0 × am/pm)
ALTER TABLE "amortization_alert_deliveries"
  ADD COLUMN IF NOT EXISTS "slot" VARCHAR(16) NOT NULL DEFAULT 'd1_am';

DROP INDEX IF EXISTS "amortization_alert_deliveries_reference_date_channel_destination_key";

CREATE UNIQUE INDEX IF NOT EXISTS "amortization_alert_deliveries_reference_date_channel_destination_slot_key"
  ON "amortization_alert_deliveries"("reference_date", "channel", "destination", "slot");

-- Per-user OpenWA session (opt-in recipients)
CREATE TABLE IF NOT EXISTS "whatsapp_sessions" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "phone" VARCHAR(32),
  "phone_normalized" VARCHAR(20),
  "openwa_session_id" VARCHAR(64),
  "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
  "connected_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_sessions_user_id_key" ON "whatsapp_sessions"("user_id");
CREATE INDEX IF NOT EXISTS "whatsapp_sessions_status_idx" ON "whatsapp_sessions"("status");
CREATE INDEX IF NOT EXISTS "whatsapp_sessions_phone_normalized_idx" ON "whatsapp_sessions"("phone_normalized");

DO $$ BEGIN
  ALTER TABLE "whatsapp_sessions"
    ADD CONSTRAINT "whatsapp_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
