-- Soft delete LGPD: Party.excluido + deleted_at; CPF unique only while active.

DO $$ BEGIN
  ALTER TYPE "party_status" ADD VALUE 'excluido';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "deleted_by_id" UUID;

DROP INDEX IF EXISTS "parties_cpf_cnpj_key";

CREATE UNIQUE INDEX IF NOT EXISTS "parties_cpf_cnpj_active_uidx"
  ON "parties" ("cpf_cnpj")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "parties_cpf_cnpj_idx" ON "parties" ("cpf_cnpj");
CREATE INDEX IF NOT EXISTS "parties_deleted_at_idx" ON "parties" ("deleted_at");
