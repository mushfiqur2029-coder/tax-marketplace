-- 0065: Two new notification_type enum values so admin can see every
-- case-lifecycle event, not just the ones that happen to flip
-- cases.status (which notify_case_change already fans out to admin).
--
-- Status-change events that admin already gets via the 0013 trigger:
--   draft -> submitted (payment completed)
--   submitted -> in_review (accountant took the case)
--   in_review -> prepared
--   prepared -> client_approval (accountant sent for approval)
--   client_approval -> filed (client approved and filed)
--   filed -> complete
--
-- Events that are only a column write (no status change) and so slip
-- past that trigger:
--   case created at draft/pending (INSERT not followed by status change)
--   onboarding_submitted_at stamp
--   period_docs_submitted_at stamp
--   vat_return_cycles status changes (separate table, separate trigger
--     chain, which fans only to the assigned accountant today)
--   case_addons status changes (separate table too)
--
-- period_docs_submitted / vat_docs_submitted / vat_filed /
-- addon_paid types already exist from earlier migrations; we extend
-- their TS insert helpers to ALSO fan to admin without needing new
-- enum values. The only new types we need are the two below.

alter type public.notification_type add value if not exists 'case_created';
alter type public.notification_type add value if not exists 'onboarding_submitted';
