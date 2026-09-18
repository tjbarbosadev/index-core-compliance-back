-- AlterTable
ALTER TABLE "onboarding_processes" ADD COLUMN IF NOT EXISTS "approval_justification" TEXT;
ALTER TABLE "onboarding_processes" ADD COLUMN IF NOT EXISTS "approved_by_id" UUID;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "investment_status" AS ENUM ('pendente', 'aprovado', 'cancelado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "transaction_type" AS ENUM ('aporte', 'resgate', 'amortizacao', 'rendimento', 'compra_ativo', 'venda_ativo');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "transaction_counterparty" AS ENUM ('cotista', 'cedente', 'fundo', 'outro');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "transaction_status" AS ENUM ('pendente', 'aprovado', 'estornado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "fund_bank_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fund_id" UUID NOT NULL,
    "bank_code" VARCHAR(10) NOT NULL,
    "bank_name" VARCHAR(100),
    "branch" VARCHAR(10) NOT NULL,
    "account" VARCHAR(20) NOT NULL,
    "account_type" VARCHAR(20) NOT NULL DEFAULT 'corrente',
    "pix_key" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fund_bank_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "fund_bank_accounts_fund_id_key" ON "fund_bank_accounts"("fund_id");

DO $$ BEGIN
  ALTER TABLE "fund_bank_accounts" ADD CONSTRAINT "fund_bank_accounts_fund_id_fkey"
    FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "fund_investments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fund_id" UUID NOT NULL,
    "asset_class" "asset_class" NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "justification" TEXT NOT NULL,
    "cedente_id" UUID,
    "acquisition_document_uri" TEXT,
    "payment_proof_uri" TEXT,
    "status" "investment_status" NOT NULL DEFAULT 'aprovado',
    "acquired_at" DATE NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fund_investments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "fund_investments_fund_id_asset_class_idx" ON "fund_investments"("fund_id", "asset_class");
CREATE INDEX IF NOT EXISTS "fund_investments_cedente_id_idx" ON "fund_investments"("cedente_id");

DO $$ BEGIN
  ALTER TABLE "fund_investments" ADD CONSTRAINT "fund_investments_fund_id_fkey"
    FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "fund_investments" ADD CONSTRAINT "fund_investments_cedente_id_fkey"
    FOREIGN KEY ("cedente_id") REFERENCES "cedentes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "fund_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fund_id" UUID NOT NULL,
    "type" "transaction_type" NOT NULL,
    "counterparty_kind" "transaction_counterparty" NOT NULL,
    "party_id" UUID,
    "amount" DECIMAL(18,2) NOT NULL,
    "signed_amount" DECIMAL(18,2) NOT NULL,
    "description" VARCHAR(500),
    "proof_uri" TEXT,
    "status" "transaction_status" NOT NULL DEFAULT 'aprovado',
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fund_transactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "fund_transactions_fund_id_occurred_at_idx" ON "fund_transactions"("fund_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "fund_transactions_party_id_idx" ON "fund_transactions"("party_id");
CREATE INDEX IF NOT EXISTS "fund_transactions_type_status_idx" ON "fund_transactions"("type", "status");

DO $$ BEGIN
  ALTER TABLE "fund_transactions" ADD CONSTRAINT "fund_transactions_fund_id_fkey"
    FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
