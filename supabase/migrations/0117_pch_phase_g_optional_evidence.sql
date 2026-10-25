-- Phase G: simplifying two cards down to a single amount + optional
-- upload. Both uploads need a storage-path column to land on, same
-- pattern as the Phase F/0113 evidence columns.
--
-- other_employment_evidence: optional P60/payslip for the "Income
-- from another job" card, now a single amount field. Lives on
-- pch_cases alongside employment_income_pence/paye_pence.
--
-- private_use_evidence: optional supporting doc for the vehicle
-- private-use amount. Lives on pch_vehicle alongside
-- private_use_declared/private_use_amount_pence (migration 0115).
--
-- Applied live via apply_migration (name: pch_phase_g_optional_evidence)
-- and verified against information_schema.columns before this file
-- was written; this file tracks it.

alter table public.pch_cases
  add column if not exists other_employment_evidence text;

alter table public.pch_vehicle
  add column if not exists private_use_evidence text;
