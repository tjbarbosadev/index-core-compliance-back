-- CreateEnum
CREATE TYPE "FimRedemptionStatus" AS ENUM ('pending', 'settled');

-- CreateTable
CREATE TABLE "fim_redemptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "party_fund_link_id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "external_id" VARCHAR(128) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "requested_on" DATE NOT NULL,
    "settles_on" DATE NOT NULL,
    "status" "FimRedemptionStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fim_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fim_redemptions_partner_id_external_id_key" ON "fim_redemptions"("partner_id", "external_id");

-- CreateIndex
CREATE INDEX "fim_redemptions_party_fund_link_id_settles_on_idx" ON "fim_redemptions"("party_fund_link_id", "settles_on");

-- CreateIndex
CREATE INDEX "fim_redemptions_party_fund_link_id_status_idx" ON "fim_redemptions"("party_fund_link_id", "status");

-- AddForeignKey
ALTER TABLE "fim_redemptions" ADD CONSTRAINT "fim_redemptions_party_fund_link_id_fkey" FOREIGN KEY ("party_fund_link_id") REFERENCES "party_fund_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fim_redemptions" ADD CONSTRAINT "fim_redemptions_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "api_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
