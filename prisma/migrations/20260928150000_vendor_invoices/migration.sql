-- CreateEnum
CREATE TYPE "billing_vendor" AS ENUM ('bigdatacorp', 'lemit', 'apollo');

-- CreateEnum
CREATE TYPE "vendor_invoice_status" AS ENUM ('pendente', 'pago', 'cancelado');

-- CreateTable
CREATE TABLE "vendor_invoices" (
    "id" UUID NOT NULL,
    "vendor" "billing_vendor" NOT NULL,
    "reference_month" DATE NOT NULL,
    "description" VARCHAR(255),
    "amount" DECIMAL(18,2) NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "vendor_invoice_status" NOT NULL DEFAULT 'pendente',
    "boleto_line" VARCHAR(64),
    "boleto_url" TEXT,
    "document_uri" TEXT,
    "document_name" VARCHAR(255),
    "notes" TEXT,
    "paid_at" TIMESTAMPTZ,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vendor_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_invoices_status_due_date_idx" ON "vendor_invoices"("status", "due_date");

-- CreateIndex
CREATE INDEX "vendor_invoices_vendor_reference_month_idx" ON "vendor_invoices"("vendor", "reference_month");

-- AddForeignKey
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
