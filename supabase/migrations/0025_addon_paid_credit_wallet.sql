-- Add-on commission: 50% of amount_pence credited to the accountant's
-- wallet as soon as a case_addons row transitions to 'paid'. Same 50/50
-- split as every other line of revenue. Credited immediately (not tied to
-- case complete) since add-on work often happens mid-case.
--
-- Baseline is 0020's on_case_complete_credit_wallet in spirit — a single
-- security-definer trigger function, an insert into wallet_transactions
-- with status 'available', an amount read off the row so a future catalog
-- price change or admin edit does not retroactively rewrite the commission.
--
-- Trigger fires on INSERT too, not just UPDATE, because case_addons's
-- CHECK constraint permits a preset row to be inserted directly at 'paid'
-- (unused today by the app, but the schema allows it). If we ever wire
-- that path, the wallet still gets credited correctly.

create or replace function public.on_addon_paid_credit_wallet()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount integer;
begin
  if new.status = 'paid'
     and (tg_op = 'INSERT' or old.status is distinct from 'paid')
     and new.accountant_id is not null
  then
    v_amount := new.amount_pence / 2;  -- 50% commission
    if v_amount > 0 then
      insert into public.wallet_transactions
        (accountant_id, case_id, type, amount_pence, status)
      values (new.accountant_id, new.case_id, 'earning', v_amount, 'available');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists case_addon_paid_credit_wallet on public.case_addons;
create trigger case_addon_paid_credit_wallet
after insert or update on public.case_addons
for each row execute function public.on_addon_paid_credit_wallet();

-- ==========================================================================
-- Backfill: any case_addons row already at 'paid' before this migration
-- does not have a matching wallet_transactions row (the trigger only fires
-- forward). Insert the missing earning rows now so accountants are not
-- silently owed money.
--
-- Idempotency: matches on (accountant_id, case_id, type, amount_pence).
-- False-match risk: a case-completion earning (from 0020) with the same
-- accountant + case + amount would prevent the backfill from firing. In
-- practice the amounts collide only when an add-on's commission equals the
-- plan's commission on the same case for the same accountant — rare, and
-- the trigger will still cover every future add-on payment cleanly.
-- ==========================================================================

insert into public.wallet_transactions
  (accountant_id, case_id, type, amount_pence, status)
select
  a.accountant_id,
  a.case_id,
  'earning',
  a.amount_pence / 2,
  'available'
from public.case_addons a
where a.status = 'paid'
  and a.accountant_id is not null
  and (a.amount_pence / 2) > 0
  and not exists (
    select 1
    from public.wallet_transactions wt
    where wt.accountant_id = a.accountant_id
      and wt.case_id = a.case_id
      and wt.type = 'earning'
      and wt.amount_pence = a.amount_pence / 2
  );
