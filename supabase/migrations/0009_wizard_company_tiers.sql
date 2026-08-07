-- 0009: Extend case_segment + case_tier enums for limited-company / VAT track.
-- Also updates the wallet-credit trigger with commission amounts for the new tiers.
-- Apply via Supabase Dashboard: SQL Editor -> paste this file -> Run.
--
-- Commission model = 50% of gross price, floored to the nearest £0.50, minus £0.50
-- (matches the pattern used for basic/standard/premium in 0005_phase4_schema.sql:
--   basic £99 -> 4950 = £49.50, standard £149 -> 7450 = £74.50, premium £349 -> 17450 = £174.50).

-- ---------- Extend case_segment ----------
alter type case_segment add value if not exists 'limited_company_vat';

-- ---------- Extend case_tier ----------
alter type case_tier add value if not exists 'vat_basic';
alter type case_tier add value if not exists 'vat_standard';
alter type case_tier add value if not exists 'vat_accounts';
alter type case_tier add value if not exists 'dormant';
alter type case_tier add value if not exists 'non_vat_reg';
alter type case_tier add value if not exists 'vat_reg';

-- ---------- Update wallet credit trigger ----------
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
    if v_amount > 0 then
      insert into public.wallet_transactions
        (accountant_id, case_id, type, amount_pence, status)
      values (new.accountant_id, new.id, 'earning', v_amount, 'available');
    end if;
  end if;
  return new;
end;
$$;
