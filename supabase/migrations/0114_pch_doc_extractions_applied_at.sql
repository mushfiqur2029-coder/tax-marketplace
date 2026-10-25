-- Phase B of the PCH intake rebuild writes a server action that
-- copies the latest PCH-24 (photo ID) extraction's fields into
-- pch_cases.cl_name / cl_dob / cl_address / cl_postcode so the
-- client's identity inputs populate the moment the vision call
-- finishes. It originally tried to mark that extraction row as
-- status='applied' to avoid re-firing on later page loads, but
-- pch_doc_extractions.status is a check-constrained enum of
-- ('pending', 'done', 'error', 'skipped'); the update silently
-- failed, and on every page load after a client edited an auto-
-- filled field, the still-'done' extraction got re-applied and
-- clobbered the client's edit back to the OCR value.
--
-- Fix: add a dedicated boolean marker column. applied_at is set
-- when autoApplyPch24ExtractionAction has copied the fields into
-- pch_cases; the action's query filters on applied_at IS NULL so
-- a once-applied extraction is never re-applied.
--
-- Pure additive, no touch to status's existing enum or any other
-- column.

alter table public.pch_doc_extractions
  add column if not exists applied_at timestamptz;

create index if not exists pch_doc_extractions_applied_at_idx
  on public.pch_doc_extractions(case_id, applied_at)
  where applied_at is null;
