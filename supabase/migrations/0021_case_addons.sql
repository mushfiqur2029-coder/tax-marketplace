-- Add-on services: an accountant can request extra work on an existing
-- case, priced separately, mid-way through the job.
--
-- Two flavours:
--   preset  — accountant picks from admin-managed addon_catalog. No admin
--             review; goes straight to pending_payment so the client can
--             pay for it.
--   custom  — accountant types a description and amount. Requires admin
--             approval (status='pending_admin') before the client sees it.
--
-- Snapshot at creation: case_addons.description and .amount_pence are copied
-- from the catalog row at insert time, and preset_key is a soft reference.
-- This is the same pattern as cases.urgent_fee_pence — a later catalog
-- price change or deactivation must not retroactively rewrite an existing
-- add-on's price or the wallet split that follows from it.
--
-- Payment: each add-on gets its own Stripe Checkout session, separate from
-- the case's original payment. Commission goes 50/50 like everything else,
-- credited to the accountant's wallet on paid (not case complete), since
-- add-on work usually happens mid-case. The wallet trigger lives in a later
-- migration so it can be reviewed on its own.

-- ==========================================================================
-- Enums
-- ==========================================================================

do $$ begin
  create type case_addon_kind as enum ('preset', 'custom');
exception when duplicate_object then null; end $$;

do $$ begin
  create type case_addon_status as enum (
    'pending_admin', 'pending_payment', 'paid', 'rejected'
  );
exception when duplicate_object then null; end $$;

-- ==========================================================================
-- addon_catalog: admin-managed price list of preset add-ons.
-- ==========================================================================

create table if not exists public.addon_catalog (
  key         text primary key,
  name        text not null,
  description text not null,
  amount_pence integer not null check (amount_pence > 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.addon_catalog enable row level security;

-- Everyone signed-in can read active catalog rows: accountants need the
-- picker, clients+admin see snapshot references on cases. Admin needs to
-- see inactive rows too (to reactivate or edit).
drop policy if exists "addon_catalog_read_active" on public.addon_catalog;
create policy "addon_catalog_read_active" on public.addon_catalog
  for select using (active = true or public.is_admin());

drop policy if exists "addon_catalog_admin_write" on public.addon_catalog;
create policy "addon_catalog_admin_write" on public.addon_catalog
  for all using (public.is_admin()) with check (public.is_admin());

-- ==========================================================================
-- Seed starter catalog. On conflict do nothing so re-running is idempotent
-- and later admin edits are not clobbered.
-- ==========================================================================

insert into public.addon_catalog (key, name, description, amount_pence) values
  ('extra_property',
   'Additional rental property',
   'Adds another rental property to your Self Assessment: income, expenses, and mortgage interest.',
   4500),
  ('capital_gains',
   'Capital gains schedule',
   'Capital gains from shares, crypto, or a property sale, calculated and reported.',
   7500),
  ('extra_income_source',
   'Additional income source',
   'An extra source of income not covered by the base plan (side income, one-off work).',
   4000),
  ('foreign_income',
   'Foreign income or rental',
   'Overseas rental income, foreign pension, or other foreign earnings, with double-tax treatment.',
   7500),
  ('bookkeeping_catchup',
   'Bookkeeping catch-up (up to 12 months)',
   'We reconstruct your books from bank statements and receipts, ready to file from.',
   15000),
  ('amend_return',
   'Amend a previously filed return',
   'Correct and resubmit a Self Assessment that has already been filed with HMRC.',
   12000)
on conflict (key) do nothing;

-- ==========================================================================
-- case_addons: one row per add-on request on a case.
-- ==========================================================================

create table if not exists public.case_addons (
  id            uuid primary key default gen_random_uuid(),
  case_id       uuid not null references public.cases(id) on delete cascade,
  accountant_id uuid not null references public.users(id) on delete restrict,
  kind          case_addon_kind not null,
  -- Soft ref to the catalog row this was picked from. Null for custom.
  -- No FK: catalog rows may be deleted, but the snapshot on this row
  -- (description, amount_pence) stays authoritative.
  preset_key    text,
  description   text not null,
  amount_pence  integer not null check (amount_pence > 0),
  status        case_addon_status not null,
  -- Its own Stripe session/payment, kept separate from the case's original.
  stripe_checkout_session_id text,
  stripe_payment_id          text,
  created_at    timestamptz not null default now(),
  -- Only meaningful for custom add-ons that pass through admin.
  reviewed_at   timestamptz,
  reviewed_by   uuid references public.users(id) on delete set null,
  review_note   text,
  paid_at       timestamptz,
  -- A preset add-on skips admin review; a custom one starts there. Enforce
  -- so a caller can't insert a row with the wrong initial status.
  constraint case_addons_initial_status_matches_kind check (
    (kind = 'preset' and status in ('pending_payment', 'paid', 'rejected'))
    or (kind = 'custom')
  ),
  constraint case_addons_preset_has_key check (
    (kind = 'preset' and preset_key is not null)
    or (kind = 'custom' and preset_key is null)
  )
);

create index if not exists case_addons_case_idx on public.case_addons(case_id);
create index if not exists case_addons_accountant_idx on public.case_addons(accountant_id);
create index if not exists case_addons_status_idx on public.case_addons(status);

alter table public.case_addons enable row level security;

-- Read: the case's client, the assigned accountant on the case, or admin.
drop policy if exists "case_addons_read" on public.case_addons;
create policy "case_addons_read" on public.case_addons
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.cases c
      where c.id = case_addons.case_id
        and (c.client_id = auth.uid() or c.accountant_id = auth.uid())
    )
  );

-- Insert: only the assigned accountant on the case can request an add-on,
-- and only rows attributed to themselves. Preset rows must start
-- pending_payment; custom rows must start pending_admin. This is the
-- server-side amount authority: even if the client tried to insert with a
-- forged amount, RLS blocks them.
drop policy if exists "case_addons_accountant_insert" on public.case_addons;
create policy "case_addons_accountant_insert" on public.case_addons
  for insert with check (
    accountant_id = auth.uid()
    and exists (
      select 1 from public.cases c
      where c.id = case_addons.case_id and c.accountant_id = auth.uid()
    )
    and (
      (kind = 'preset' and status = 'pending_payment')
      or (kind = 'custom' and status = 'pending_admin')
    )
  );

-- Update: admin manages status transitions (approve/reject custom, mark
-- paid). No direct update from clients or accountants; their state
-- transitions run through security-definer RPCs or Stripe webhook code
-- using the service role.
drop policy if exists "case_addons_admin_update" on public.case_addons;
create policy "case_addons_admin_update" on public.case_addons
  for update using (public.is_admin()) with check (public.is_admin());

-- Realtime so client and admin dashboards can react to new/updated add-ons.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'case_addons'
  ) then
    execute 'alter publication supabase_realtime add table public.case_addons';
  end if;
end $$;
alter table public.case_addons replica identity full;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'addon_catalog'
  ) then
    execute 'alter publication supabase_realtime add table public.addon_catalog';
  end if;
end $$;
alter table public.addon_catalog replica identity full;
