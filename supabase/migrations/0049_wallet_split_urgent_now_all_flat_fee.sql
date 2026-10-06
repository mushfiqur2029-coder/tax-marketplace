-- Deadline + urgent now applies to Limited Company too (same client-
-- picked filing-deadline mechanic Personal already uses, reinstated for
-- LC in the same wizard step). The trigger body is unchanged — the
-- urgent branch has always been segment-agnostic — but 0048's inline
-- comment claimed "Limited Company never sets is_urgent so this is a
-- no-op there". That is no longer true: LC sets is_urgent on urgent
-- cases exactly like Personal, and the trigger adds urgent_fee_pence /
-- 2 to the accountant's wallet credit for either segment.

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
    -- Urgent fee splits 50/50 like the base fee. Both current flat-fee
    -- segments (Personal + Limited Company) can set is_urgent via the
    -- shared wizard deadline step.
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
