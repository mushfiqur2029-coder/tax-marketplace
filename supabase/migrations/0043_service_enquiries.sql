-- Service enquiries: pre-sales leads that don't fit the engagement →
-- payment → onboarding → case flow. First use case is the "VAT
-- Registered + Accounts (over £200k turnover)" tier where we scope
-- and price bespoke after a short call.
--
-- Kept deliberately generic (service_key) so future bespoke tiers
-- across any segment can slot in without a schema change.

create extension if not exists "pgcrypto";

create table if not exists public.service_enquiries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.users(id) on delete cascade,
  service_key text not null,
  company_name text not null,
  company_number text not null,
  -- 'active' | 'dissolved' | 'liquidation' | ... | 'unknown' for
  -- manual entry. Snapshotted from the pick at submit time so a
  -- later Companies House status change doesn't rewrite history.
  company_status text,
  contact_name text not null,
  contact_email text not null,
  contact_phone text not null,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'closed')),
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_enquiries_status_created_idx
  on public.service_enquiries (status, created_at desc);
create index if not exists service_enquiries_client_idx
  on public.service_enquiries (client_id, created_at desc);

-- updated_at trigger — admins mutate status + notes, both are
-- surfaced in the enquiries list so we want "last touched" visible
-- without an app-side bookkeeping burden.
create or replace function public.set_service_enquiries_updated_at()
returns trigger language plpgsql as $$
begin
  NEW.updated_at = now();
  return NEW;
end $$;

drop trigger if exists service_enquiries_set_updated_at
  on public.service_enquiries;
create trigger service_enquiries_set_updated_at
  before update on public.service_enquiries
  for each row execute function public.set_service_enquiries_updated_at();

alter table public.service_enquiries enable row level security;

-- Client self-insert: can create enquiries where client_id is their
-- own user id. Prevents a signed-in client from spoofing another
-- client's identity on an enquiry row.
drop policy if exists "service_enquiries_client_insert" on public.service_enquiries;
create policy "service_enquiries_client_insert" on public.service_enquiries
  for insert with check (client_id = auth.uid());

-- Client self-read: can see their own enquiries. (Not strictly used
-- by the client UI yet — the thanks screen is in-page — but future
-- "my enquiries" view will need this and the policy is harmless.)
drop policy if exists "service_enquiries_client_select" on public.service_enquiries;
create policy "service_enquiries_client_select" on public.service_enquiries
  for select using (client_id = auth.uid());

-- Admin read: any admin can see any enquiry. is_admin() is the
-- helper used across every other admin RLS policy in this schema.
drop policy if exists "service_enquiries_admin_all" on public.service_enquiries;
create policy "service_enquiries_admin_all" on public.service_enquiries
  for all using (public.is_admin()) with check (public.is_admin());

-- ==========================================================================
-- Notification type: add 'service_enquiry' to the enum used by the
-- notifications table. Postgres enums can't be ALTERed inside a
-- transaction in some contexts, so use the safe add-value-if-not-
-- exists idiom.
-- ==========================================================================
do $$ begin
  alter type public.notification_type add value if not exists 'service_enquiry';
exception when duplicate_object then null; end $$;

-- ==========================================================================
-- Trigger: fan a 'service_enquiry' notification out to every admin on
-- insert. Mirrors notify_case_change's "new_queue_case" fanout.
-- The notification case_id stays null — enquiries aren't cases. The
-- bell's linkFor() routes 'service_enquiry' to /admin/enquiries where
-- the admin can click through.
-- ==========================================================================
create or replace function public.notify_service_enquiry()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.notifications (recipient_id, type, case_id, message)
  select u.id, 'service_enquiry', null,
         format('New enquiry: %s (%s).', NEW.company_name, NEW.service_key)
    from public.users u
   where u.role = 'admin';
  return NEW;
end $$;

drop trigger if exists service_enquiries_notify on public.service_enquiries;
create trigger service_enquiries_notify
  after insert on public.service_enquiries
  for each row execute function public.notify_service_enquiry();

-- Realtime publication — admin list page uses the same realtime
-- refresh pattern as the cases pages (optional nice-to-have; the
-- admin's bell notification already covers hard refresh).
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'service_enquiries'
  ) then
    execute 'alter publication supabase_realtime add table public.service_enquiries';
  end if;
end $$;
alter table public.service_enquiries replica identity full;
