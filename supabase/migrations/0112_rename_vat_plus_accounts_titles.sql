-- Rename the two "VAT Registered + Accounts" tier titles for naming
-- consistency.
--
-- Every other company-group tier title follows "<thing> company"
-- sentence case: "Dormant company", "Non-VAT registered company",
-- "VAT-registered company". These two broke that pattern (title case,
-- "VAT Registered" instead of "VAT-registered", "+ Accounts" instead
-- of folding "accounts" into the sentence), which made the limited
-- company / business pricing list look inconsistent next to the rest.
--
-- vat_plus_accounts_200k: "VAT Registered + Accounts (over £200k
--   turnover)" -> "VAT-registered company (over £200k turnover)"
-- vat_plus_accounts_bespoke: "VAT Registered + Accounts (bespoke)"
--   -> "VAT-registered company (bespoke)"
--
-- Applied live via execute_sql on 2026-10-25; this file tracks that
-- change. src/lib/plans.ts's static fallback titles and the one
-- matching error-message string in admin/actions.ts were updated in
-- the same commit so the DB and code-level fallback never drift.

update public.service_catalog
   set title = 'VAT-registered company (over £200k turnover)'
 where id = 'vat_plus_accounts_200k';

update public.service_catalog
   set title = 'VAT-registered company (bespoke)'
 where id = 'vat_plus_accounts_bespoke';
