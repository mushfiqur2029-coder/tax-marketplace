-- Wallet-credit trigger picks up the urgent fee.
--
-- Baseline: this is the 0009 tier-lookup function verbatim, plus one added
-- branch that adds 50% of urgent_fee_pence (£50 for the current £100 fee)
-- when the case was booked as urgent. Verified nothing between 0010 and
-- 0019 redefines on_case_complete_credit_wallet before writing this.
--
-- Reads urgent_fee_pence off the row rather than a hardcoded constant so
-- a future price change doesn't retroactively rewrite historic splits.

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
      when 'basic'        then 4950   -- £99   -> £49.50
      when 'standard'     then 7450   -- £149  -> £74.50
      when 'premium'      then 17450  -- £349  -> £174.50
      when 'vat_basic'    then 6450   -- £129  -> £64.50
      when 'vat_standard' then 4950   -- £99   -> £49.50 (per quarter)
      when 'vat_accounts' then 22450  -- £449  -> £224.50
      when 'dormant'      then 4450   -- £89   -> £44.50
      when 'non_vat_reg'  then 16450  -- £329  -> £164.50
      when 'vat_reg'      then 20950  -- £419  -> £209.50
      else 0
    end;
    if coalesce(new.is_urgent, false) then
      v_amount := v_amount + (coalesce(new.urgent_fee_pence, 0) / 2);
    end if;
    if v_amount > 0 then
      insert into public.wallet_transactions
        (accountant_id, case_id, type, amount_pence, status)
      values (new.accountant_id, new.id, 'earning', v_amount, 'available');
    end if;
  end if;
  return new;
end;
$$;
