-- AlterTable
ALTER TABLE "api_partners" ADD COLUMN IF NOT EXISTS "email" VARCHAR(255);

UPDATE "api_partners" SET "email" = 'parceiro@localhost' WHERE "email" IS NULL OR "email" = '';

ALTER TABLE "api_partners" ALTER COLUMN "email" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "api_partners_email_idx" ON "api_partners"("email");

-- CreateTable
CREATE TABLE IF NOT EXISTS "api_partner_request_logs" (
    "id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "path" VARCHAR(512) NOT NULL,
    "status_code" INTEGER NOT NULL,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(512),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_partner_request_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "api_partner_request_logs_partner_id_created_at_idx" ON "api_partner_request_logs"("partner_id", "created_at" DESC);

ALTER TABLE "api_partner_request_logs" DROP CONSTRAINT IF EXISTS "api_partner_request_logs_partner_id_fkey";
ALTER TABLE "api_partner_request_logs" ADD CONSTRAINT "api_partner_request_logs_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "api_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
