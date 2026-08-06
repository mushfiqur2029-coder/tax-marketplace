-- Phase 4 schema — chat channels + attachments, wallet + withdrawals,
-- admin RLS for cases/messages/reassignment, receipt storage.
-- Apply after 0004_accountant_update_cases.sql.

-- ==================================================================
-- MESSAGES: channels + attachments
-- ==================================================================

do $$ begin
  create type message_channel as enum (
    'client_accountant', 'client_admin', 'accountant_admin'
  );
exception when duplicate_object then null; end $$;

alter table public.messages
  add column if not exists channel message_channel not null default 'client_accountant',
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists attachment_type text;

create index if not exists messages_case_channel_idx
  on public.messages(case_id, channel, created_at);

-- Replace phase-3 messages RLS with channel-aware policies.
drop policy if exists "messages_read_case_parties" on public.messages;
drop policy if exists "messages_insert_case_parties" on public.messages;

-- Read policy: everyone with a stake in this channel of this case.
create policy "messages_read_channel_parties" on public.messages
  for select using (
    exists (
      select 1 from public.cases c
      where c.id = case_id and (
        (channel = 'client_accountant'
           and (c.client_id = auth.uid() or c.accountant_id = auth.uid() or public.is_admin()))
        or (channel = 'client_admin'
           and (c.client_id = auth.uid() or public.is_admin()))
        or (channel = 'accountant_admin'
           and (c.accountant_id = auth.uid() or public.is_admin()))
      )
    )
  );

-- Insert policy: must be a party to the channel.
create policy "messages_insert_channel_parties" on public.messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.cases c
      where c.id = case_id and (
        (channel = 'client_accountant'
           and (c.client_id = auth.uid() or c.accountant_id = auth.uid()))
        or (channel = 'client_admin'
           and (c.client_id = auth.uid() or public.is_admin()))
        or (channel = 'accountant_admin'
           and (c.accountant_id = auth.uid() or public.is_admin()))
      )
    )
  );

-- ==================================================================
-- CASES: admin can update (for reassignment)
-- ==================================================================

drop policy if exists "cases_admin_update_all" on public.cases;
create policy "cases_admin_update_all" on public.cases
  for update using (public.is_admin()) with check (public.is_admin());

-- ==================================================================
-- ADMIN_ACTIONS: RLS
-- ==================================================================

alter table public.admin_actions enable row level security;

drop policy if exists "admin_actions_admin_all" on public.admin_actions;
create policy "admin_actions_admin_all" on public.admin_actions
  for all using (public.is_admin())
  with check (public.is_admin() and admin_id = auth.uid());

drop policy if exists "admin_actions_target_read" on public.admin_actions;
create policy "admin_actions_target_read" on public.admin_actions
  for select using (target_user_id = auth.uid());

-- ==================================================================
-- WALLET
-- ==================================================================

do $$ begin
  create type wallet_transaction_type as enum ('earning', 'withdrawal');
exception when duplicate_object then null; end $$;
do $$ begin
  create type wallet_transaction_status as enum ('available', 'pending_withdrawal', 'paid');
exception when duplicate_object then null; end $$;
do $$ begin
  create type withdrawal_status as enum ('pending', 'paid');
exception when duplicate_object then null; end $$;

create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  accountant_id uuid not null references public.users(id) on delete cascade,
  amount_pence integer not null check (amount_pence > 0),
  account_name text not null,
  sort_code text not null,
  account_number text not null,
  status withdrawal_status not null default 'pending',
  receipt_path text,
  requested_at timestamptz not null default now(),
  paid_at timestamptz,
  paid_by uuid references public.users(id)
);
create index if not exists withdrawal_requests_accountant_idx on public.withdrawal_requests(accountant_id, status);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  accountant_id uuid not null references public.users(id) on delete cascade,
  case_id uuid references public.cases(id) on delete set null,
  type wallet_transaction_type not null default 'earning',
  amount_pence integer not null,
  status wallet_transaction_status not null default 'available',
  withdrawal_request_id uuid references public.withdrawal_requests(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists wallet_tx_accountant_status_idx on public.wallet_transactions(accountant_id, status);

alter table public.wallet_transactions enable row level security;
alter table public.withdrawal_requests enable row level security;

drop policy if exists "wallet_tx_read_own_or_admin" on public.wallet_transactions;
create policy "wallet_tx_read_own_or_admin" on public.wallet_transactions
  for select using (accountant_id = auth.uid() or public.is_admin());

drop policy if exists "withdrawal_read_own_or_admin" on public.withdrawal_requests;
create policy "withdrawal_read_own_or_admin" on public.withdrawal_requests
  for select using (accountant_id = auth.uid() or public.is_admin());

-- No direct INSERT/UPDATE from clients — go through security-definer RPCs.

-- ==================================================================
-- TRIGGER: on case complete → credit accountant wallet 50%
-- ==================================================================

create or replace function public.on_case_complete_credit_wallet()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount integer;
begin
  if new.status = 'complete'
     and (old.status is null or old.status <> 'complete')
     and new.accountant_id is not null
  then
    v_amount := case new.tier
      when 'basic'    then 4950   -- £49.50
      when 'standard' then 7450   -- £74.50
      when 'premium'  then 17450  -- £174.50
      else 0
    end;
    if v_amount > 0 then
      insert into public.wallet_transactions
        (accountant_id, case_id, type, amount_pence, status)
      values (new.accountant_id, new.id, 'earning', v_amount, 'available');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists case_complete_credit on public.cases;
create trigger case_complete_credit
after update on public.cases
for each row execute function public.on_case_complete_credit_wallet();

-- ==================================================================
-- RPC: request_withdrawal (atomically move available → pending)
-- ==================================================================

create or replace function public.request_withdrawal(
  p_account_name text,
  p_sort_code text,
  p_account_number text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_amount integer;
  v_req_id uuid;
begin
  if v_uid is null then raise exception 'not signed in'; end if;

  perform 1 from public.users where id = v_uid and role = 'accountant';
  if not found then raise exception 'not an accountant'; end if;

  select coalesce(sum(amount_pence), 0)
    into v_amount
    from public.wallet_transactions
   where accountant_id = v_uid and status = 'available' and type = 'earning';

  if v_amount <= 0 then raise exception 'no available balance'; end if;

  insert into public.withdrawal_requests
    (accountant_id, amount_pence, account_name, sort_code, account_number)
  values
    (v_uid, v_amount, p_account_name, p_sort_code, p_account_number)
  returning id into v_req_id;

  update public.wallet_transactions
     set status = 'pending_withdrawal', withdrawal_request_id = v_req_id
   where accountant_id = v_uid and status = 'available' and type = 'earning';

  return v_req_id;
end;
$$;

-- ==================================================================
-- RPC: mark_withdrawal_paid (admin marks paid, sets receipt path)
-- ==================================================================

create or replace function public.mark_withdrawal_paid(
  p_request_id uuid,
  p_receipt_path text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not admin'; end if;

  update public.withdrawal_requests
     set status = 'paid',
         paid_at = now(),
         paid_by = auth.uid(),
         receipt_path = p_receipt_path
   where id = p_request_id and status = 'pending';

  if not found then raise exception 'request not pending'; end if;

  update public.wallet_transactions
     set status = 'paid'
   where withdrawal_request_id = p_request_id;
end;
$$;

-- ==================================================================
-- STORAGE: message attachments (case-documents/{caseId}/msg/...)
-- ==================================================================

drop policy if exists "case-documents_msg_upload" on storage.objects;
create policy "case-documents_msg_upload" on storage.objects
  for insert with check (
    bucket_id = 'case-documents'
    and (storage.foldername(name))[2] = 'msg'
    and exists (
      select 1 from public.cases c
      where c.id::text = (storage.foldername(name))[1]
        and (
          c.client_id = auth.uid()
          or c.accountant_id = auth.uid()
          or public.is_admin()
        )
    )
  );

-- Existing read policies (client_read, accountant_read, admin_read) already
-- cover reading anything under {caseId}/... so msg attachments work.

-- ==================================================================
-- REALTIME: wallet_transactions + withdrawal_requests
-- ==================================================================

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wallet_transactions'
  ) then
    execute 'alter publication supabase_realtime add table public.wallet_transactions';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'withdrawal_requests'
  ) then
    execute 'alter publication supabase_realtime add table public.withdrawal_requests';
  end if;
end
$$;

alter table public.wallet_transactions replica identity full;
alter table public.withdrawal_requests replica identity full;
