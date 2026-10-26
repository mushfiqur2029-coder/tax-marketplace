-- Fix "operator does not exist: text = case_tier" thrown by
-- on_case_complete_credit_wallet() whenever an accountant clicks "Mark
-- filed and complete" on a non-bespoke, non-manual-override case.
--
-- Migration 0111 (wallet_commission_live_sale_price) introduced:
--   select price_gbp, sale_price_gbp into v_price_gbp, v_sale_gbp
--     from public.service_catalog where id = new.tier;
-- service_catalog.id is text; cases.tier is the case_tier enum.
-- Postgres has no = operator between text and case_tier without an
-- explicit cast, so this statement failed every time it was reached.
-- Fix: cast new.tier to text, same as migration 0058's one-off backfill
-- already did correctly (c.tier::text = sc.id).
--
-- Applied live via apply_migration on 2026-10-26; this file tracks that
-- change (same pattern migration 0111's own header used).

create or replace function public.on_case_complete_credit_wallet()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount integer;
  v_price_gbp integer;
  v_sale_gbp integer;
begin
  if new.status = 'complete'
     and (old.status is null or old.status <> 'complete')
     and new.accountant_id is not null
  then
    if new.accountant_commission_pence is not null then
      v_amount := new.accountant_commission_pence;
    elsif new.custom_fee_pence is not null then
      v_amount := new.custom_fee_pence / 2;
    else
      select price_gbp, sale_price_gbp
        into v_price_gbp, v_sale_gbp
        from public.service_catalog
       where id = new.tier::text;
      v_amount := round(coalesce(v_sale_gbp, v_price_gbp, 0) * 100 * 0.5);
    end if;
    if coalesce(new.is_urgent, false) then
      v_amount := v_amount + (coalesce(new.urgent_fee_pence, 0) / 2);
    end if;
    if v_amount > 0 then
      insert into public.wallet_transactions
        (accountant_id, case_id, type, amount_pence, status)
      values (new.accountant_id, new.id, 'earning', v_amount, 'available')
      on conflict (case_id) where type = 'earning'::wallet_transaction_type and case_id is not null
      do nothing;
    end if;
  end if;
  return new;
end;
$$;
