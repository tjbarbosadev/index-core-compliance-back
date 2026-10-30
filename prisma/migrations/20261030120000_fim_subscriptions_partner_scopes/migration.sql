ALTER TABLE "api_partners" ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "fim_subscriptions" (
    "id" UUID NOT NULL,
    "party_fund_link_id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "external_id" VARCHAR(128) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "occurred_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fim_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fim_subscriptions_partner_id_external_id_key" ON "fim_subscriptions"("partner_id", "external_id");
CREATE INDEX "fim_subscriptions_party_fund_link_id_occurred_on_idx" ON "fim_subscriptions"("party_fund_link_id", "occurred_on");

ALTER TABLE "fim_subscriptions" ADD CONSTRAINT "fim_subscriptions_party_fund_link_id_fkey" FOREIGN KEY ("party_fund_link_id") REFERENCES "party_fund_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fim_subscriptions" ADD CONSTRAINT "fim_subscriptions_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "api_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
