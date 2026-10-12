-- 0064: Merge the two bank-statement period-doc slots into one.
--
-- The onboarding/period-docs schema used to split company bank
-- statements across two upload slots keyed by requirement_key:
--   period_bank_statements_pdf  (PDF statements only)
--   period_bank_statements_csv  (CSV / XLSX / XLS transaction exports)
-- The TS schema in src/lib/engagement/period-docs.ts now exposes a
-- single `period_bank_statements` slot that accepts both formats in
-- the same drop zone (clients were sorting files twice, and the per-
-- slot MIME guard occasionally mis-fired on CSVs that OSes reported
-- as application/octet-stream).
--
-- This migration rewrites existing case_documents rows so already-
-- uploaded statements re-link to the merged slot in both the client
-- period-docs form and the accountant/admin review panels. Without
-- this, uploads tied to the old ids would appear orphaned (empty new
-- slot) and the required-missing count would misreport.
--
-- Idempotent — the IN clause is a no-op if the old ids are already
-- gone, and the new id has no uniqueness constraint on
-- (case_id, requirement_key) so re-tagging two rows to the same id
-- on the same case is fine.

update public.case_documents
set requirement_key = 'period_bank_statements'
where requirement_key in (
  'period_bank_statements_pdf',
  'period_bank_statements_csv'
);
