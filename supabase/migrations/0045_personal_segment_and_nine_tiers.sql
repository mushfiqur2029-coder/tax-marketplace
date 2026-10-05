-- Personal flow restructure. The old Personal journey was
--   segment (one of 6: first_time_filer, self_employed, landlord, ...)
--     -> tier  (one of 3: basic / standard / premium)
--     -> intake form -> deadline -> upload docs -> pay.
--
-- Replaced by a 9-up flat-fee picker that mirrors Limited Company:
--   segment = 'personal'
--     -> tier (one of 9) -> engagement letter -> pay -> doc checklist.
--
-- This migration:
--   1. Adds 'personal' to the case_segment enum.
--   2. Adds 9 new values to the case_tier enum (one per service).
--   3. Updates on_case_complete_credit_wallet() with the new 50/50
--      split amounts for all 9 personal tiers.
--
-- Old personal enum values (basic / standard / premium) and the old
-- 6 segment values (first_time_filer / self_employed / landlord /
-- investor / cis / high_earner) are intentionally NOT dropped —
-- dropping enum values in Postgres is painful, and all case data
-- was wiped before this flow lands so there is nothing to migrate.
-- The TypeScript side filters them out of the wizard, and the
-- server guard in createCaseAction rejects them on insert.

-- 1) Enum: add 'personal' segment ------------------------------------------
do $$ begin
  alter type case_segment add value if not exists 'personal';
end $$;

-- 2) Enum: add 9 new personal tiers ---------------------------------------
do $$ begin
  alter type case_tier add value if not exists 'uber_driver';
  alter type case_tier add value if not exists 'cis_subcontractor';
  alter type case_tier add value if not exists 'sole_trader';
  alter type case_tier add value if not exists 'landlord_small';
  alter type case_tier add value if not exists 'non_resident_landlord';
  alter type case_tier add value if not exists 'gig_worker';
  alter type case_tier add value if not exists 'freelancer_consultant';
  alter type case_tier add value if not exists 'landlord_multi';
  alter type case_tier add value if not exists 'complex_international';
end $$;

-- 3) Commission trigger: add the 9 new tiers at 50/50 split ---------------
--
-- Fee → wallet credit on case complete (50% of the fee):
--   uber_driver             £199  → £99.50   (9950 pence)
--   cis_subcontractor       £299  → £149.50  (14950)
--   sole_trader             £199  → £99.50   (9950)
--   landlord_small          £250  → £125.00  (12500)
--   non_resident_landlord   £399  → £199.50  (19950)
--   gig_worker              £199  → £99.50   (9950)
--   freelancer_consultant   £199  → £99.50   (9950)
--   landlord_multi          £599  → £299.50  (29950)
--   complex_international   £1000 → £500.00  (50000)
--
-- Old personal tiers (basic/standard/premium) are retained in the case
-- statement for safety even though they are no longer sold — a case
-- in that tier can still complete and credit the historical amount.
-- Limited-company tiers unchanged.

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
      -- Personal: new 9-tier flat-fee catalogue (50/50 split).
      when 'uber_driver'            then 9950
      when 'cis_subcontractor'      then 14950
      when 'sole_trader'            then 9950
      when 'landlord_small'         then 12500
      when 'non_resident_landlord'  then 19950
      when 'gig_worker'             then 9950
      when 'freelancer_consultant'  then 9950
      when 'landlord_multi'         then 29950
      when 'complex_international'  then 50000
      -- Personal: retired tiers (kept for historical cases, if any).
      when 'basic'                  then 4950
      when 'standard'               then 7450
      when 'premium'                then 17450
      -- Limited-company flat-fee services (50/50 split).
      when 'dormant'                then 7500
      when 'non_vat_reg'            then 35000
      when 'vat_reg'                then 50000
      -- Legacy company tiers (not sold, retained for safety).
      when 'vat_basic'              then 6450
      when 'vat_standard'           then 4950
      when 'vat_accounts'           then 22450
      else 0
    end;
    -- Urgent fee only applies on the old personal path; new personal
    -- tiers never set is_urgent / urgent_fee_pence, so this branch is
    -- effectively dead code for them. Kept for the retired tiers.
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
