-- 0087: Linked prior-year cases.
--
-- When returns-owed flags a prior tax year as outstanding, the client
-- can elect to include that year. The flow creates a new case for the
-- same tier scoped to that tax year, linked back to the original via
-- parent_case_id. The parent is always the "current year" case the
-- client started from.
--
-- tax_year_label is a short UK tax-year string like "2024/25" that the
-- engine uses to pick the correct rate pack. Nullable because every
-- existing case defaults to the current year via src/lib/tax-engine
-- (UK_TAX_RATES_2025_26) when NULL; backfill not required.
--
-- Index on parent_case_id so the dashboard can quickly surface a
-- parent's children.

alter table public.cases
  add column if not exists parent_case_id uuid references public.cases(id) on delete set null,
  add column if not exists tax_year_label text;

create index if not exists cases_parent_case_idx
  on public.cases (parent_case_id)
  where parent_case_id is not null;
