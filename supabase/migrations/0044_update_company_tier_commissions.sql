-- Re-pricing of the three self-serve Limited Company services:
--   Dormant                              £400 → £150
--   Non-VAT registered                   £400 → £700
--   VAT Registered + Accounts (<£200k)   £400 → £1000
--
-- Commission stays 50/50 (same split as every other tier on the
-- platform) so the wallet credit per completed case follows:
--   dormant      → £75  (7500 pence)
--   non_vat_reg  → £350 (35000 pence)
--   vat_reg      → £500 (50000 pence)
--
-- Historic case rows that completed BEFORE this trigger lands keep
-- the £200 credit they were awarded at the time — we're not back-
-- dating wallet balances, that would be wrong. Only cases that
-- transition into 'complete' from here on use the new split.
--
-- Personal tiers (basic / standard / premium) and the legacy LC
-- enum values (vat_basic / vat_standard / vat_accounts) are
-- unchanged.
--
-- The 4th tier vat_plus_accounts_200k (Bespoke, over £200k turnover)
-- is intentionally NOT in this branch — those engagements go
-- through the enquiry form, never land in cases.tier, and are
-- billed and credited outside the platform's flat-fee flow.

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
      -- Limited-company flat-fee services, 50/50 split.
      when 'dormant'      then 7500   -- £150  -> £75.00
      when 'non_vat_reg'  then 35000  -- £700  -> £350.00
      when 'vat_reg'      then 50000  -- £1000 -> £500.00
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
