-- CreateTable
CREATE TABLE "partner_documents" (
    "id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "cotista_id" UUID NOT NULL,
    "label" VARCHAR(120),
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "mega_id" VARCHAR(128) NOT NULL,
    "mega_path" VARCHAR(1024) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partner_documents_partner_id_party_id_idx" ON "partner_documents"("partner_id", "party_id");

-- CreateIndex
CREATE INDEX "partner_documents_cotista_id_idx" ON "partner_documents"("cotista_id");

-- CreateIndex
CREATE UNIQUE INDEX "partner_documents_partner_id_party_id_sha256_key" ON "partner_documents"("partner_id", "party_id", "sha256");

-- AddForeignKey
ALTER TABLE "partner_documents" ADD CONSTRAINT "partner_documents_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "api_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_documents" ADD CONSTRAINT "partner_documents_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_documents" ADD CONSTRAINT "partner_documents_cotista_id_fkey" FOREIGN KEY ("cotista_id") REFERENCES "cotistas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
