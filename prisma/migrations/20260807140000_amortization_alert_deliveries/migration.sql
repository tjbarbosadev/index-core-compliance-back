-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "amortization_alert_channel" AS ENUM ('telegram');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "amortization_alert_delivery_status" AS ENUM ('sent');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "amortization_alert_deliveries" (
    "id" UUID NOT NULL,
    "reference_date" DATE NOT NULL,
    "channel" "amortization_alert_channel" NOT NULL,
    "status" "amortization_alert_delivery_status" NOT NULL DEFAULT 'sent',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "amortization_alert_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "amortization_alert_deliveries_reference_date_channel_key"
  ON "amortization_alert_deliveries"("reference_date", "channel");
