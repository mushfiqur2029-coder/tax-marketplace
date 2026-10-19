-- Phase 7 Slice 7.6a: three new text columns on pch_cases to hold the
-- answers from the four Slice 7.6 client-side AI interview flows.
--
-- Each column stores the client's free-form answer verbatim; the
-- commit action also writes the same text into pch_check_status.note
-- for the matching item(s) so the accountant row flips to Done
-- without a second query.
--
-- nil_platforms_note       item 5  (INCOME_PROBE)
-- expenses_probe_note      items 11 + 27 (EXPENSES_PROBE, single flow)
-- repayment_account_name   item 31 (FILING_DETAILS)
--
-- RELIEFS (item 19) writes to existing head columns and VEHICLE_CA_EXT
-- (item 16) writes to existing pch_vehicle columns, so neither needs
-- a schema change here.
--
-- All three default null, nullable; a case that never ran the
-- corresponding interview leaves them as null and the checklist row
-- stays as the "Waiting on client" shell.

alter table public.pch_cases
  add column if not exists nil_platforms_note text,
  add column if not exists expenses_probe_note text,
  add column if not exists repayment_account_name text;
