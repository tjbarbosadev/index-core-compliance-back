-- CreateEnum
CREATE TYPE "cedente_contract_kind" AS ENUM ('emprestimo', 'antecipacao', 'outro');

-- CreateTable
CREATE TABLE "cedente_contracts" (
    "id" UUID NOT NULL,
    "onboarding_id" UUID NOT NULL,
    "kind" "cedente_contract_kind" NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "notes" TEXT,
    "document_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cedente_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cedente_contracts_document_id_key" ON "cedente_contracts"("document_id");

-- CreateIndex
CREATE INDEX "cedente_contracts_onboarding_id_idx" ON "cedente_contracts"("onboarding_id");

-- AddForeignKey
ALTER TABLE "cedente_contracts" ADD CONSTRAINT "cedente_contracts_onboarding_id_fkey" FOREIGN KEY ("onboarding_id") REFERENCES "onboarding_processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cedente_contracts" ADD CONSTRAINT "cedente_contracts_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
