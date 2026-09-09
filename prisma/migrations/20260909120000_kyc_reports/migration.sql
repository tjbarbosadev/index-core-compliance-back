-- CreateTable
CREATE TABLE "kyc_reports" (
    "id" UUID NOT NULL,
    "document" VARCHAR(18) NOT NULL,
    "document_type" VARCHAR(4) NOT NULL,
    "party_id" UUID,
    "onboarding_id" UUID,
    "risk_level" "risk_level" NOT NULL,
    "compliance_status" VARCHAR(40) NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "dossier_json" JSONB NOT NULL,
    "report_hash" VARCHAR(80) NOT NULL,
    "pdf_uri" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kyc_reports_document_idx" ON "kyc_reports"("document");

-- CreateIndex
CREATE INDEX "kyc_reports_party_id_idx" ON "kyc_reports"("party_id");

-- CreateIndex
CREATE INDEX "kyc_reports_created_at_idx" ON "kyc_reports"("created_at");

-- AddForeignKey
ALTER TABLE "kyc_reports" ADD CONSTRAINT "kyc_reports_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_reports" ADD CONSTRAINT "kyc_reports_onboarding_id_fkey" FOREIGN KEY ("onboarding_id") REFERENCES "onboarding_processes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_reports" ADD CONSTRAINT "kyc_reports_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
