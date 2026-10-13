-- 0068: Fix race on request_withdrawal (RPC from migration 0005).
--
-- The original RPC reads the sum of available earnings, inserts a
-- withdrawal_requests row at that amount, then flips the matching
-- wallet_transactions rows to 'pending_withdrawal'. Nothing is
-- locked between those steps, so two concurrent calls can both:
--   1. read the same available sum
--   2. insert their own withdrawal_requests row at that sum
--   3. UPDATE wallet_transactions - but only the first flip
--      actually matches rows; the second UPDATE affects zero rows
--
-- Net result: a second withdrawal_requests row exists at an amount
-- with no backing wallet rows. Admin pays it, and the accountant
-- gets paid twice for the same earning rows.
--
-- Fix: SELECT the earning rows with FOR UPDATE before summing, so
-- a concurrent transaction waits on the row locks until the first
-- commits (or is rolled back). Also compare the row count affected
-- by the final UPDATE against the expected count - belt-and-braces
-- against a column being touched between SELECT and UPDATE in the
-- same transaction (shouldn't happen, but if it ever does the
-- withdrawal is rolled back loudly instead of silently
-- misreporting).

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
  v_expected_count integer;
  v_actual_count integer;
  v_req_id uuid;
begin
  if v_uid is null then raise exception 'not signed in'; end if;

  perform 1 from public.users where id = v_uid and role = 'accountant';
  if not found then raise exception 'not an accountant'; end if;

  -- Lock every eligible wallet row for this accountant. A concurrent
  -- request_withdrawal() for the same accountant blocks here until
  -- this transaction commits; postgres row-level locks are the
  -- correct primitive for this (the alternative, a serialisable
  -- isolation level, would cost more and still need retry logic).
  -- We also capture the row count so the post-UPDATE check below
  -- can compare and refuse to proceed on a mismatch.
  select coalesce(sum(amount_pence), 0), count(*)
    into v_amount, v_expected_count
    from public.wallet_transactions
   where accountant_id = v_uid
     and status = 'available'
     and type = 'earning'
   for update;

  if v_amount <= 0 then raise exception 'no available balance'; end if;

  insert into public.withdrawal_requests
    (accountant_id, amount_pence, account_name, sort_code, account_number)
  values
    (v_uid, v_amount, p_account_name, p_sort_code, p_account_number)
  returning id into v_req_id;

  update public.wallet_transactions
     set status = 'pending_withdrawal', withdrawal_request_id = v_req_id
   where accountant_id = v_uid
     and status = 'available'
     and type = 'earning';
  get diagnostics v_actual_count = row_count;

  if v_actual_count <> v_expected_count then
    raise exception
      'withdrawal row count mismatch: locked % rows but updated % - rolling back'
      , v_expected_count, v_actual_count;
  end if;

  return v_req_id;
end;
$$;
