-- Section 4 (P11D) had only a free-text benefits_note, no numeric
-- figure, which the engine can't use for anything beyond context on
-- review. Add the standard *_pence amount column (same pattern as
-- dividend_income_pence, capital_gains_pence, etc. from migration
-- 0113), kept alongside benefits_note rather than replacing it, since
-- a one-line description of what the benefit is (company car, health
-- insurance, etc.) is still useful context for the accountant.
--
-- Applied live via apply_migration (name: pch_p11d_amount) and
-- verified against information_schema.columns before this file was
-- written; this file tracks it.

alter table public.pch_cases
  add column if not exists p11d_pence integer;
