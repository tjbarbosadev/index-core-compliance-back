-- Simulation parties: included in portal/admin, excluded from consolidated PL sums.
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "exclude_from_pl" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "parties_exclude_from_pl_idx" ON "parties"("exclude_from_pl");
