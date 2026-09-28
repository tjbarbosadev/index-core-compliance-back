-- CreateEnum
CREATE TYPE "cedente_stage" AS ENUM ('rascunho', 'aguardando_assinatura', 'em_analise_juridica', 'pendencia_juridica', 'em_analise_compliance', 'aprovado', 'rejeitado');

-- CreateEnum
CREATE TYPE "legal_review_decision" AS ENUM ('favoravel', 'pendencia', 'desfavoravel');

-- CreateEnum
CREATE TYPE "signature_envelope_status" AS ENUM ('pendente', 'assinado', 'recusado', 'cancelado');

-- AlterEnum
ALTER TYPE "document_type" ADD VALUE 'comprovante_endereco_empresa';
ALTER TYPE "document_type" ADD VALUE 'identidade_representante';
ALTER TYPE "document_type" ADD VALUE 'comprovante_endereco_representante';
ALTER TYPE "document_type" ADD VALUE 'ficha_cadastral_pj';
ALTER TYPE "document_type" ADD VALUE 'cartao_assinatura';
ALTER TYPE "document_type" ADD VALUE 'dre';
ALTER TYPE "document_type" ADD VALUE 'declaracao_faturamento';
ALTER TYPE "document_type" ADD VALUE 'certidao';
ALTER TYPE "document_type" ADD VALUE 'parecer_juridico';

-- AlterTable
ALTER TABLE "documents" ADD COLUMN "slot" VARCHAR(100);

-- AlterTable
ALTER TABLE "onboarding_processes" ADD COLUMN "cedente_stage" "cedente_stage";

-- Backfill existing cedente processes
UPDATE "onboarding_processes"
SET "cedente_stage" = CASE "status"
  WHEN 'aprovado' THEN 'aprovado'::"cedente_stage"
  WHEN 'rejeitado' THEN 'rejeitado'::"cedente_stage"
  WHEN 'expirado' THEN 'rejeitado'::"cedente_stage"
  ELSE 'rascunho'::"cedente_stage"
END
WHERE "kind" = 'cedente';

-- Permission catalog: legal review (production has no seed on deploy)
INSERT INTO "permissions" ("id", "key", "description", "module")
VALUES (gen_random_uuid(), 'cedentes.legal_review', 'Parecer jurídico do onboarding de cedente', 'cedentes')
ON CONFLICT ("key") DO NOTHING;

-- CreateTable
CREATE TABLE "signature_envelopes" (
    "id" UUID NOT NULL,
    "onboarding_id" UUID NOT NULL,
    "provider" VARCHAR(30) NOT NULL DEFAULT 'zapsign',
    "external_token" VARCHAR(100) NOT NULL,
    "document_id" UUID,
    "status" "signature_envelope_status" NOT NULL DEFAULT 'pendente',
    "sandbox" BOOLEAN NOT NULL DEFAULT false,
    "signers_json" JSONB NOT NULL DEFAULT '[]',
    "signed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "signature_envelopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_reviews" (
    "id" UUID NOT NULL,
    "onboarding_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "decision" "legal_review_decision" NOT NULL,
    "opinion" TEXT NOT NULL,
    "pending_items_json" JSONB NOT NULL DEFAULT '[]',
    "document_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "legal_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "signature_envelopes_external_token_key" ON "signature_envelopes"("external_token");

-- CreateIndex
CREATE INDEX "signature_envelopes_onboarding_id_idx" ON "signature_envelopes"("onboarding_id");

-- CreateIndex
CREATE INDEX "legal_reviews_onboarding_id_created_at_idx" ON "legal_reviews"("onboarding_id", "created_at");

-- CreateIndex
CREATE INDEX "documents_party_id_slot_idx" ON "documents"("party_id", "slot");

-- CreateIndex
CREATE INDEX "onboarding_processes_kind_cedente_stage_idx" ON "onboarding_processes"("kind", "cedente_stage");

-- AddForeignKey
ALTER TABLE "signature_envelopes" ADD CONSTRAINT "signature_envelopes_onboarding_id_fkey" FOREIGN KEY ("onboarding_id") REFERENCES "onboarding_processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_reviews" ADD CONSTRAINT "legal_reviews_onboarding_id_fkey" FOREIGN KEY ("onboarding_id") REFERENCES "onboarding_processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_reviews" ADD CONSTRAINT "legal_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
