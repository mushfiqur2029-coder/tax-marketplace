-- Phase 1 schema for the Tax Return Marketplace.
-- Apply via Supabase Dashboard: SQL Editor -> paste this file -> Run.

-- ---------- Enums ----------
do $$ begin create type user_role as enum ('client', 'accountant', 'admin'); exception when duplicate_object then null; end $$;
do $$ begin create type user_status as enum ('active', 'warned', 'suspended'); exception when duplicate_object then null; end $$;
do $$ begin create type case_segment as enum ('first_time_filer', 'self_employed', 'landlord', 'investor', 'cis', 'high_earner'); exception when duplicate_object then null; end $$;
do $$ begin create type case_tier as enum ('basic', 'standard', 'premium'); exception when duplicate_object then null; end $$;
do $$ begin create type case_status as enum ('draft', 'submitted', 'in_review', 'prepared', 'client_approval', 'filed', 'complete'); exception when duplicate_object then null; end $$;
do $$ begin create type payment_status as enum ('pending', 'succeeded', 'failed', 'refunded'); exception when duplicate_object then null; end $$;
do $$ begin create type admin_action_type as enum ('warning', 'suspend', 'reinstate'); exception when duplicate_object then null; end $$;

-- ---------- Tables ----------
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role user_role not null default 'client',
  status user_status not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists public.client_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  name text
);

create table if not exists public.accountant_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  name text,
  credentials text,
  specialisms text[],
  stripe_connect_id text
);

create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.users(id) on delete cascade,
  accountant_id uuid references public.users(id) on delete set null,
  segment case_segment not null,
  tier case_tier not null,
  status case_status not null default 'draft',
  stripe_payment_id text,
  stripe_payment_status payment_status not null default 'pending',
  created_at timestamptz not null default now()
);
create index if not exists cases_client_id_idx on public.cases(client_id);
create index if not exists cases_accountant_id_idx on public.cases(accountant_id);
create index if not exists cases_status_idx on public.cases(status);

create table if not exists public.case_documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  uploaded_by uuid not null references public.users(id) on delete cascade,
  file_url text not null,
  file_name text not null,
  uploaded_at timestamptz not null default now()
);
create index if not exists case_documents_case_id_idx on public.case_documents(case_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  sender_id uuid not null references public.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists messages_case_id_idx on public.messages(case_id);

create table if not exists public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references public.users(id) on delete cascade,
  admin_id uuid not null references public.users(id) on delete cascade,
  action admin_action_type not null,
  note text,
  created_at timestamptz not null default now()
);

-- ---------- Trigger: on auth.users insert, create public.users + profile ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_name text;
begin
  v_role := coalesce(nullif(new.raw_user_meta_data->>'role', '')::user_role, 'client');
  v_name := new.raw_user_meta_data->>'name';

  insert into public.users (id, email, role)
  values (new.id, new.email, v_role)
  on conflict (id) do nothing;

  if v_role = 'accountant' then
    insert into public.accountant_profiles (user_id, name)
    values (new.id, v_name)
    on conflict (user_id) do nothing;
  else
    insert into public.client_profiles (user_id, name)
    values (new.id, v_name)
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------- RLS ----------
alter table public.users enable row level security;
alter table public.client_profiles enable row level security;
alter table public.accountant_profiles enable row level security;
alter table public.cases enable row level security;
alter table public.case_documents enable row level security;
alter table public.messages enable row level security;
alter table public.admin_actions enable row level security;

-- Users: can read own row.
drop policy if exists "users_read_own" on public.users;
create policy "users_read_own" on public.users
  for select using (auth.uid() = id);

-- Client profiles: owner read/update.
drop policy if exists "client_profiles_read_own" on public.client_profiles;
create policy "client_profiles_read_own" on public.client_profiles
  for select using (auth.uid() = user_id);
drop policy if exists "client_profiles_update_own" on public.client_profiles;
create policy "client_profiles_update_own" on public.client_profiles
  for update using (auth.uid() = user_id);

-- Accountant profiles: owner read/update.
drop policy if exists "accountant_profiles_read_own" on public.accountant_profiles;
create policy "accountant_profiles_read_own" on public.accountant_profiles
  for select using (auth.uid() = user_id);
drop policy if exists "accountant_profiles_update_own" on public.accountant_profiles;
create policy "accountant_profiles_update_own" on public.accountant_profiles
  for update using (auth.uid() = user_id);

-- Phase 2/3/4 will add case, document, message, and admin policies.
