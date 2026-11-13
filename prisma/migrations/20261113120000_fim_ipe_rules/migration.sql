-- CreateEnum
CREATE TYPE "FimSubscriptionStatus" AS ENUM ('pending', 'active', 'cancelled');

-- AlterEnum
ALTER TYPE "FimRedemptionStatus" ADD VALUE IF NOT EXISTS 'cancelled';

-- AlterTable fim_subscriptions
ALTER TABLE "fim_subscriptions" ADD COLUMN IF NOT EXISTS "accrues_on" DATE;
ALTER TABLE "fim_subscriptions" ADD COLUMN IF NOT EXISTS "status" "FimSubscriptionStatus" NOT NULL DEFAULT 'active';
ALTER TABLE "fim_subscriptions" ADD COLUMN IF NOT EXISTS "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "fim_subscriptions" SET "accrues_on" = "occurred_on" WHERE "accrues_on" IS NULL;

ALTER TABLE "fim_subscriptions" ALTER COLUMN "accrues_on" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "fim_subscriptions_party_fund_link_id_status_accrues_on_idx"
  ON "fim_subscriptions"("party_fund_link_id", "status", "accrues_on");
