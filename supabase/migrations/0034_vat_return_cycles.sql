-- Batch 5: recurring VAT return cycles for vat_reg cases.
--
-- Lifecycle per cycle: awaiting_client_docs → in_review (client submits
-- period docs) → client_approval (accountant assembles box 1-9 payload
-- and uploads the return PDF) → filed (client approves and files).
--
-- The accountant enters the FIRST period end date once per case; the
-- system computes everything else (start date from the frequency in
-- Section D, HMRC due date from end + 1m 7d, period label). Each
-- subsequent cycle auto-creates on the previous one being marked filed
-- so the client always has a current cycle to work on. Dates can be
-- overridden by the accountant if needed via editVatCycleDatesAction.
--
-- Status machine is independent of the main case.status — a case can
-- be at status='complete' (Batch 4 Annual Accounts + CT filed) while
-- VAT cycles continue monthly/quarterly/annually below it.

do $$ begin
  create type vat_cycle_status as enum (
    'awaiting_client_docs',
    'in_review',
    'client_approval',
    'filed'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.vat_return_cycles (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  -- Cycle ordinal within this case. Set server-side at insert time to
  -- max(cycle_number)+1 so we don't need a sequence per case. Unique
  -- within (case_id, cycle_number) so two concurrent inserts can't
  -- both land as #N.
  cycle_number int not null,
  -- Human label, e.g. "Q1 Jan–Mar 2026", "January 2026", "Year ending
  -- 31 Dec 2026". Computed from the dates + Section D frequency at
  -- insert time but stored so UI doesn't need to re-derive it.
  period_label text not null,
  cycle_start_date date not null,
  cycle_end_date date not null,
  -- HMRC due = end + 1 month 7 days. Generated so an updated end date
  -- cannot leave this field stale.
  cycle_hmrc_due_date date generated always as (
    (cycle_end_date + interval '1 month 7 days')::date
  ) stored,
  status vat_cycle_status not null default 'awaiting_client_docs',
  client_docs_submitted_at timestamptz,
  -- Box 1-9 + optional note + prepared_by/at. Shaped like
  -- cases.approval_payload (Batch 4) so UI can reuse the "no VAT
  -- payable" conditional messaging pattern — Box 5 drives the
  -- client-facing liability display.
  approval_payload jsonb,
  filed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.users(id),
  constraint vat_return_cycles_dates_order check (cycle_start_date <= cycle_end_date),
  unique (case_id, cycle_number)
);

create index if not exists vat_return_cycles_case_idx
  on public.vat_return_cycles(case_id, cycle_number desc);

-- VAT cycle docs are tagged by cycle_id so filtering per cycle is a
-- single-column join rather than parsing requirement_key strings.
-- Null on all pre-Batch-5 rows (onboarding + period docs). Cascade on
-- cycle delete so an accountant-reset doesn't leave orphans.
alter table public.case_documents
  add column if not exists vat_cycle_id uuid
    references public.vat_return_cycles(id) on delete cascade;

create index if not exists case_documents_vat_cycle_idx
  on public.case_documents(vat_cycle_id)
  where vat_cycle_id is not null;

-- ==========================================================================
-- RLS
-- ==========================================================================
alter table public.vat_return_cycles enable row level security;

drop policy if exists "vat_cycles_client_select_own" on public.vat_return_cycles;
create policy "vat_cycles_client_select_own" on public.vat_return_cycles
  for select using (
    exists (
      select 1 from public.cases c
      where c.id = case_id and c.client_id = auth.uid()
    )
  );

-- Client UPDATE scope: stamping client_docs_submitted_at (submit own
-- uploads) and transitioning status client_approval → filed (approve
-- and file). Server actions enforce which column / which transition —
-- RLS just gates "is this client authorised to touch this cycle".
drop policy if exists "vat_cycles_client_update_own" on public.vat_return_cycles;
create policy "vat_cycles_client_update_own" on public.vat_return_cycles
  for update
  using (
    exists (
      select 1 from public.cases c
      where c.id = case_id and c.client_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.cases c
      where c.id = case_id and c.client_id = auth.uid()
    )
  );

drop policy if exists "vat_cycles_accountant_select_own" on public.vat_return_cycles;
create policy "vat_cycles_accountant_select_own" on public.vat_return_cycles
  for select using (
    exists (
      select 1 from public.cases c
      where c.id = case_id and c.accountant_id = auth.uid()
    )
  );

drop policy if exists "vat_cycles_accountant_update_own" on public.vat_return_cycles;
create policy "vat_cycles_accountant_update_own" on public.vat_return_cycles
  for update
  using (
    exists (
      select 1 from public.cases c
      where c.id = case_id and c.accountant_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.cases c
      where c.id = case_id and c.accountant_id = auth.uid()
    )
  );

drop policy if exists "vat_cycles_accountant_insert_own" on public.vat_return_cycles;
create policy "vat_cycles_accountant_insert_own" on public.vat_return_cycles
  for insert
  with check (
    exists (
      select 1 from public.cases c
      where c.id = case_id and c.accountant_id = auth.uid()
    )
    and created_by = auth.uid()
  );

drop policy if exists "vat_cycles_admin_select_all" on public.vat_return_cycles;
create policy "vat_cycles_admin_select_all" on public.vat_return_cycles
  for select using (public.is_admin());
