-- Admins get their own profile table so name / contact_number live somewhere
-- editable from the app. Parallel shape to client_profiles / accountant_profiles.
-- Admin profile edits apply IMMEDIATELY (no admin-approval loop — there is no
-- one above admin to approve), so pending_profile_changes is NOT used for admins.

create table if not exists public.admin_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  name text,
  contact_number text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-touch updated_at on any row modification (touch_updated_at is defined
-- in 0002_phase2_schema.sql).
drop trigger if exists admin_profiles_touch on public.admin_profiles;
create trigger admin_profiles_touch
before update on public.admin_profiles
for each row execute function public.touch_updated_at();

-- ==========================================================================
-- Extend handle_new_user: create admin_profiles row for new admin signups.
-- (Previous version in 0007 skipped admins entirely.)
-- ==========================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_name text;
  v_contact_number text;
  v_address text;
  v_company_email text;
  v_company_name text;
begin
  v_role := coalesce(nullif(new.raw_user_meta_data->>'role', '')::user_role, 'client');
  v_name := new.raw_user_meta_data->>'name';
  v_contact_number := new.raw_user_meta_data->>'contact_number';
  v_address := new.raw_user_meta_data->>'address';
  v_company_email := new.raw_user_meta_data->>'company_email';
  v_company_name := new.raw_user_meta_data->>'company_name';

  insert into public.users (id, email, role)
  values (new.id, new.email, v_role)
  on conflict (id) do nothing;

  if v_role = 'accountant' then
    insert into public.accountant_profiles
      (user_id, name, contact_number, company_email, company_name)
    values
      (new.id, v_name, v_contact_number, v_company_email, v_company_name)
    on conflict (user_id) do nothing;
  elsif v_role = 'admin' then
    insert into public.admin_profiles (user_id, name, contact_number)
    values (new.id, v_name, v_contact_number)
    on conflict (user_id) do nothing;
  else
    insert into public.client_profiles
      (user_id, name, contact_number, address)
    values
      (new.id, v_name, v_contact_number, v_address)
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

-- ==========================================================================
-- Backfill: create admin_profiles rows for existing admins that pre-date
-- this migration (e.g. the bootstrap admin created before 0010 shipped).
-- ==========================================================================
insert into public.admin_profiles (user_id, name, contact_number)
select
  u.id,
  au.raw_user_meta_data->>'name',
  au.raw_user_meta_data->>'contact_number'
from public.users u
join auth.users au on au.id = u.id
where u.role = 'admin'
  and not exists (select 1 from public.admin_profiles p where p.user_id = u.id);

-- ==========================================================================
-- RLS
-- ==========================================================================
alter table public.admin_profiles enable row level security;

-- An admin can read every admin profile row (used for the "admins" list page
-- and for reading their own name in getCurrentUser).
drop policy if exists "admin_profiles_admin_read" on public.admin_profiles;
create policy "admin_profiles_admin_read" on public.admin_profiles
  for select using (public.is_admin());

-- Owner can update their own row.
drop policy if exists "admin_profiles_owner_update" on public.admin_profiles;
create policy "admin_profiles_owner_update" on public.admin_profiles
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
