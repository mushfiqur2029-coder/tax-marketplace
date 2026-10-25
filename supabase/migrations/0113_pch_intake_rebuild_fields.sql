-- PCH intake rebuild: new fields the manual client-driven form captures
-- that didn't have homes on the old AI-chat intake. Pure additive
-- schema change; everything else (pch_vehicle, pch_income_lines,
-- pch_expense_lines, engine snapshot shape) is untouched.
--
-- Sections 4-14 of the new intake each resolve to Applicable or Not
-- applicable per client declaration; `cl_declaration_status` is the
-- jsonb map ({"p11d":"applicable","interest":"not_applicable",...})
-- recording that answer. "Not applicable" is a real recorded state the
-- accountant view honours by showing nothing for the item, exactly as
-- the client marked it. Blank/missing key = "not answered yet",
-- distinct from "not applicable".
--
-- Gift Aid is a repeatable mini-list (charity, date, amount) so it
-- lives in its own table like pch_income_lines: one row per donation,
-- live-saved independently as the client types without having to
-- serialise the whole list on every keystroke.
--
-- Dividend / capital gains / child benefit / overseas / "anything
-- else" / last-year SA fields are v1 accountant-informational only --
-- stored but not wired into engine-snapshot.ts for this iteration. The
-- accountant can apply them via pch_overrides on review if the
-- computed tax needs adjusting. A later migration can promote the ones
-- (dividend tax rates, HICBC on child benefit) into the engine.

alter table public.pch_cases
  -- Section 4 (P11D benefits, if not payrolled)
  add column if not exists p11d_evidence text,
  -- Section 5 (Interest income - certificates of interest)
  add column if not exists interest_evidence text,
  -- Section 6 (Dividend income - vouchers, portfolio summary)
  add column if not exists dividend_income_pence integer check (dividend_income_pence is null or dividend_income_pence >= 0),
  add column if not exists dividend_evidence text,
  -- Section 7 (Capital gains + supporting documents)
  add column if not exists capital_gains_pence integer check (capital_gains_pence is null or capital_gains_pence >= 0),
  add column if not exists capital_gains_evidence text,
  add column if not exists capital_gains_note text,
  -- Section 8 (Rental UK or overseas; existing rental_profit_pence +
  -- gross_rent_received_pence hold the figures, this stores the doc)
  add column if not exists rental_evidence text,
  -- Section 9 (Private pension - non-workplace; existing
  -- personal_pension_net_pence holds the figure)
  add column if not exists pension_evidence text,
  -- Section 11 (Child benefit received)
  add column if not exists child_benefit_pence integer check (child_benefit_pence is null or child_benefit_pence >= 0),
  add column if not exists child_benefit_evidence text,
  -- Section 12 (Overseas income + tax paid overseas)
  add column if not exists overseas_income_pence integer check (overseas_income_pence is null or overseas_income_pence >= 0),
  add column if not exists overseas_tax_paid_pence integer check (overseas_tax_paid_pence is null or overseas_tax_paid_pence >= 0),
  add column if not exists overseas_evidence text,
  -- Section 13 (Student loan plan; existing student_loan_plan column
  -- holds the plan selector, this stores the doc)
  add column if not exists student_loan_evidence text,
  -- Section 14 (Anything else relevant - free text only)
  add column if not exists anything_else_note text,
  -- Section 15 (Last year's SA tax liability)
  add column if not exists last_year_sa_status text check (
    last_year_sa_status is null
    or last_year_sa_status in ('yes', 'no', 'not_applicable')
  ),
  add column if not exists last_year_sa_paid boolean,
  add column if not exists last_year_sa302_evidence text,
  -- Map of section key -> 'applicable' | 'not_applicable'. Keys:
  --   p11d, interest, dividend, capital_gains, rental, pension,
  --   gift_aid, child_benefit, overseas, student_loan, anything_else.
  -- Missing key = unanswered; present key = client has decided.
  add column if not exists cl_declaration_status jsonb default '{}'::jsonb;

-- ----------------------------------------------------------------------
-- pch_gift_aid_entries: one row per donation. Live-saved per row so a
-- client typing a new charity name doesn't rewrite the whole list.
-- ----------------------------------------------------------------------

create table if not exists public.pch_gift_aid_entries (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  charity_name text,
  donation_date date,
  amount_pence integer check (amount_pence is null or amount_pence >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pch_gift_aid_entries_case_idx
  on public.pch_gift_aid_entries(case_id);

alter table public.pch_gift_aid_entries enable row level security;

-- Case-scoped visibility, mirroring pch_income_lines (migration 0080).
-- Writes go through server actions under the admin client, so no insert
-- policy is needed for session clients.
drop policy if exists "pch_gift_aid_entries_select" on public.pch_gift_aid_entries;
create policy "pch_gift_aid_entries_select" on public.pch_gift_aid_entries
  for select using (
    exists (
      select 1 from public.cases c
      where c.id = pch_gift_aid_entries.case_id
        and (c.client_id = (select auth.uid()) or c.accountant_id = (select auth.uid()))
    )
  );

create or replace function public.pch_gift_aid_entries_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists pch_gift_aid_entries_set_updated_at on public.pch_gift_aid_entries;
create trigger pch_gift_aid_entries_set_updated_at
  before update on public.pch_gift_aid_entries
  for each row execute function public.pch_gift_aid_entries_touch_updated_at();

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pch_gift_aid_entries'
  ) then
    execute 'alter publication supabase_realtime add table public.pch_gift_aid_entries';
  end if;
end $$;
alter table public.pch_gift_aid_entries replica identity full;
