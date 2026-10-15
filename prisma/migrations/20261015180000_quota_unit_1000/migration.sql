-- Rebase quota counts to R$ 1.000 unit (investment amounts unchanged).
UPDATE "party_fund_links"
SET "quota_count" = FLOOR("initial_investment" / 1000)::int
WHERE "initial_investment" > 0
  AND MOD("initial_investment", 1000) = 0;

-- Next Core FIDC: display minAmount R$ 1.000 on Senior I / II classes.
UPDATE "funds"
SET "extra_info_json" = jsonb_set(
  "extra_info_json"::jsonb,
  '{quotaClasses}',
  (
    SELECT COALESCE(
      jsonb_agg(
        CASE
          WHEN elem ? 'minAmount' THEN jsonb_set(elem, '{minAmount}', '1000'::jsonb)
          ELSE elem
        END
      ),
      '[]'::jsonb
    )
    FROM jsonb_array_elements(COALESCE("extra_info_json"::jsonb->'quotaClasses', '[]'::jsonb)) AS elem
  )
)
WHERE "cnpj" IN ('68057459000165', '00000000000191')
  AND "extra_info_json"::jsonb ? 'quotaClasses';
