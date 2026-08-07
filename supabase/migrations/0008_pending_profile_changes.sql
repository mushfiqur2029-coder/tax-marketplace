-- Phase 6: profile edits go through admin approval instead of applying live.
-- Shared table for both clients and accountants.

do $$ begin
  create type profile_change_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

create table if not exists public.pending_profile_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  role user_role not null,
  proposed jsonb not null,           -- { name?: string, contact_number?: string, address?, company_name?, company_email? }
  status profile_change_status not null default 'pending',
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.users(id) on delete set null,
  review_note text
);

-- One pending row per user at a time (superseded by newer requests).
create index if not exists ppc_user_status_idx
  on public.pending_profile_changes (user_id, status);

alter table public.pending_profile_changes enable row level security;

-- Users read their own pending row(s).
drop policy if exists "ppc_owner_read" on public.pending_profile_changes;
create policy "ppc_owner_read" on public.pending_profile_changes
  for select using (user_id = auth.uid());

-- Users insert their own pending changes.
drop policy if exists "ppc_owner_insert" on public.pending_profile_changes;
create policy "ppc_owner_insert" on public.pending_profile_changes
  for insert with check (user_id = auth.uid() and status = 'pending');

-- Users can withdraw (delete) their own pending row before admin reviews.
drop policy if exists "ppc_owner_delete_pending" on public.pending_profile_changes;
create policy "ppc_owner_delete_pending" on public.pending_profile_changes
  for delete using (user_id = auth.uid() and status = 'pending');

-- Admin can read + update anything.
drop policy if exists "ppc_admin_all" on public.pending_profile_changes;
create policy "ppc_admin_all" on public.pending_profile_changes
  for all using (public.is_admin()) with check (public.is_admin());

-- Realtime publication so admin notifications can pick up new requests later.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pending_profile_changes'
  ) then
    execute 'alter publication supabase_realtime add table public.pending_profile_changes';
  end if;
end $$;
alter table public.pending_profile_changes replica identity full;

-- ==========================================================================
-- RPC: apply_profile_change (admin approves a pending change)
-- Writes the proposed JSON into the correct profile table + marks the row
-- approved. Runs security-definer so RLS on client_profiles /
-- accountant_profiles (which normally restricts to the owner) isn't blocking.
-- ==========================================================================

create or replace function public.apply_profile_change(
  p_change_id uuid,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pending_profile_changes%rowtype;
  v_proposed jsonb;
begin
  if not public.is_admin() then raise exception 'not admin'; end if;

  select * into v_row
    from public.pending_profile_changes
   where id = p_change_id and status = 'pending';
  if not found then raise exception 'change not pending'; end if;

  v_proposed := v_row.proposed;

  if v_row.role = 'client' then
    update public.client_profiles
       set name           = coalesce(nullif(v_proposed->>'name',           ''), name),
           contact_number = coalesce(nullif(v_proposed->>'contact_number', ''), contact_number),
           address        = coalesce(nullif(v_proposed->>'address',        ''), address)
     where user_id = v_row.user_id;
  elsif v_row.role = 'accountant' then
    update public.accountant_profiles
       set name           = coalesce(nullif(v_proposed->>'name',           ''), name),
           contact_number = coalesce(nullif(v_proposed->>'contact_number', ''), contact_number),
           company_name   = coalesce(nullif(v_proposed->>'company_name',   ''), company_name),
           company_email  = coalesce(nullif(v_proposed->>'company_email',  ''), company_email)
     where user_id = v_row.user_id;
  end if;

  -- Email lives on public.users. Update it there if changed.
  if (v_proposed->>'email') is not null and (v_proposed->>'email') <> '' then
    update public.users
       set email = v_proposed->>'email'
     where id = v_row.user_id;
  end if;

  update public.pending_profile_changes
     set status = 'approved',
         reviewed_at = now(),
         reviewed_by = auth.uid(),
         review_note = p_note
   where id = p_change_id;
end;
$$;

-- ==========================================================================
-- RPC: reject_profile_change
-- ==========================================================================

create or replace function public.reject_profile_change(
  p_change_id uuid,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  update public.pending_profile_changes
     set status = 'rejected',
         reviewed_at = now(),
         reviewed_by = auth.uid(),
         review_note = p_note
   where id = p_change_id and status = 'pending';
end;
$$;
