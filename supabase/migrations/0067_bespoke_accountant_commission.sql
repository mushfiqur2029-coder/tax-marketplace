-- 0067: Admin-set accountant commission on bespoke engagements.
--
-- The 0054 wallet trigger hardcoded a 50/50 split for every bespoke
-- case with a custom_fee_pence: `v_amount := custom_fee_pence / 2`.
-- Mushfiq wants bespoke cases (tier = vat_plus_accounts_bespoke) to
-- be the one service where the accountant's commission is a direct
-- figure admin sets per engagement, not a percentage of the client
-- fee. Everything else (flat-fee personal, flat-fee company, dormant,
-- urgent-fee uplift, legacy bespoke rows without a commission set)
-- keeps its current behavior.
--
-- Precedence order in the trigger (unchanged beyond adding the first
-- branch): accountant_commission_pence -> custom_fee_pence/2 -> tier
-- catalogue. The urgent_fee_pence/2 uplift stays unconditional on top
-- of whichever base amount is chosen.
--
-- Column shape mirrors custom_fee_pence from 0054 (nullable, > 0 when
-- set). Only ever populated by the admin bespoke-case form; every
-- non-bespoke case stays NULL and takes the fallback path, so legacy
-- bespoke cases created before this migration also keep the 50/50
-- behavior.

alter table public.cases
  add column if not exists accountant_commission_pence integer
    check (accountant_commission_pence is null or accountant_commission_pence > 0);

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
    -- Admin-set bespoke commission wins. This is the full accountant
    -- payout figure for the engagement - do NOT halve it. For bespoke
    -- cases created before this feature, accountant_commission_pence
    -- is NULL and we fall through to the previous custom_fee_pence/2
    -- behavior so in-flight / already-complete bespoke cases are not
    -- disrupted.
    if new.accountant_commission_pence is not null then
      v_amount := new.accountant_commission_pence;
    elsif new.custom_fee_pence is not null then
      v_amount := new.custom_fee_pence / 2;
    else
      v_amount := case new.tier
        -- Personal: 9-tier flat-fee catalogue (50/50 split).
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
    end if;
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
