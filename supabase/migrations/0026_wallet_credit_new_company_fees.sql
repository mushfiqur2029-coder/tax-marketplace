-- Limited-company services are now a flat £400 flat fee each
-- (Dormant / Non-VAT Registered / VAT Registered), so the wallet credit
-- for every one of them is a straight £200 commission (50%, same split as
-- everything else).
--
-- The old limited-company tier ids (vat_basic / vat_standard /
-- vat_accounts) are no longer sold by the app. Their enum values stay in
-- Postgres since dropping enum values is painful and no case rows are on
-- them. Their branches are kept at their historic amounts below as a
-- belt-and-braces fallback in case a legacy row ever lands at complete,
-- but the wizard, pricing pages, and app code no longer reference them.
--
-- Reads urgent_fee_pence off the row (matching 0020's pattern) so a
-- future urgent-fee price change doesn't retroactively rewrite historic
-- splits.

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
      -- Personal tiers (unchanged).
      when 'basic'        then 4950   -- £99   -> £49.50
      when 'standard'     then 7450   -- £149  -> £74.50
      when 'premium'      then 17450  -- £349  -> £174.50
      -- Limited-company flat-fee services (new £400 each -> £200 split).
      when 'dormant'      then 20000  -- £400  -> £200.00
      when 'non_vat_reg'  then 20000  -- £400  -> £200.00
      when 'vat_reg'      then 20000  -- £400  -> £200.00
      -- Legacy company tiers kept for safety; not sold anymore.
      when 'vat_basic'    then 6450   -- £129  -> £64.50
      when 'vat_standard' then 4950   -- £99   -> £49.50 (per quarter)
      when 'vat_accounts' then 22450  -- £449  -> £224.50
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
