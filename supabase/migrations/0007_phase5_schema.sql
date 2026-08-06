-- Phase 5 schema — expanded profile fields, accountant approval workflow,
-- deadline on cases, avatars storage, admin analytics + drill-in RLS.
-- Apply after 0006_admin_direct_reply.sql.

-- ==========================================================================
-- ENUMS
-- ==========================================================================

do $$ begin
  create type accountant_approval as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

-- Extend admin_action_type with approve/reject.
alter type admin_action_type add value if not exists 'approve_accountant';
alter type admin_action_type add value if not exists 'reject_accountant';

-- ==========================================================================
-- PROFILE FIELDS
-- ==========================================================================

alter table public.client_profiles
  add column if not exists contact_number text,
  add column if not exists address text,
  add column if not exists avatar_path text;

alter table public.accountant_profiles
  add column if not exists contact_number text,
  add column if not exists company_email text,
  add column if not exists company_name text,
  add column if not exists avatar_path text,
  add column if not exists approval_status accountant_approval not null default 'pending';

-- Any accountant that existed before Phase 5 is grandfathered as approved.
update public.accountant_profiles
  set approval_status = 'approved'
  where approval_status = 'pending';

-- ==========================================================================
-- CASE DEADLINE
-- ==========================================================================

alter table public.cases add column if not exists deadline timestamptz;
create index if not exists cases_deadline_idx on public.cases(deadline);

-- ==========================================================================
-- TRIGGER: handle_new_user with new fields
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
  elsif v_role = 'client' then
    insert into public.client_profiles
      (user_id, name, contact_number, address)
    values
      (new.id, v_name, v_contact_number, v_address)
    on conflict (user_id) do nothing;
  end if;
  -- Admin role: no profile row is auto-created. Admins are created by other
  -- admins via the admin dashboard.

  return new;
end;
$$;

-- ==========================================================================
-- RLS — accountants must be approved to see queue / take cases
-- ==========================================================================

drop policy if exists "cases_accountant_read_queue" on public.cases;
create policy "cases_accountant_read_queue" on public.cases
  for select using (
    exists (
      select 1
        from public.users u
        join public.accountant_profiles ap on ap.user_id = u.id
       where u.id = auth.uid()
         and u.role = 'accountant'
         and ap.approval_status = 'approved'
    )
    and (
      (accountant_id is null and status = 'submitted' and stripe_payment_status = 'succeeded')
      or accountant_id = auth.uid()
    )
  );

drop policy if exists "cases_accountant_update_queue_or_own" on public.cases;
create policy "cases_accountant_update_queue_or_own" on public.cases
  for update
  using (
    exists (
      select 1
        from public.users u
        join public.accountant_profiles ap on ap.user_id = u.id
       where u.id = auth.uid()
         and u.role = 'accountant'
         and ap.approval_status = 'approved'
    )
    and (
      (accountant_id is null and status = 'submitted' and stripe_payment_status = 'succeeded')
      or accountant_id = auth.uid()
    )
  )
  with check (accountant_id = auth.uid());

-- ==========================================================================
-- RLS — admins read/update on accountant/client profiles + users
-- ==========================================================================

drop policy if exists "accountant_profiles_admin_read" on public.accountant_profiles;
create policy "accountant_profiles_admin_read" on public.accountant_profiles
  for select using (public.is_admin());

drop policy if exists "accountant_profiles_admin_update" on public.accountant_profiles;
create policy "accountant_profiles_admin_update" on public.accountant_profiles
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "client_profiles_admin_read" on public.client_profiles;
create policy "client_profiles_admin_read" on public.client_profiles
  for select using (public.is_admin());

drop policy if exists "users_admin_read_all" on public.users;
create policy "users_admin_read_all" on public.users
  for select using (public.is_admin());

-- ==========================================================================
-- STORAGE — avatars bucket (public, small files)
-- ==========================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('avatars', 'avatars', true, 5242880)  -- 5 MB
on conflict (id) do update set public = excluded.public;

-- Any authenticated user can upload to their own {userId}/ prefix.
drop policy if exists "avatars_upload_own" on storage.objects;
create policy "avatars_upload_own" on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Anyone (including public) can read avatars — profile pics are non-sensitive.
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

-- Owner can update / delete their own avatar.
drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
