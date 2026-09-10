-- AlterTable
ALTER TABLE "parties" ADD COLUMN "fim_application_id" VARCHAR(36);

-- CreateIndex
CREATE UNIQUE INDEX "parties_fim_application_id_key" ON "parties"("fim_application_id");
