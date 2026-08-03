-- Allow multiple acquisitions per party (Senior I and/or II, including same type).
DROP INDEX IF EXISTS "party_fund_links_party_id_fund_id_quota_type_key";
CREATE INDEX IF NOT EXISTS "party_fund_links_party_id_idx" ON "party_fund_links"("party_id");
