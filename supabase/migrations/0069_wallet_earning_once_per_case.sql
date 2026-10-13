-- 0069: Prevent double wallet credit per case.
--
-- The on_case_complete_credit_wallet() trigger (0054, updated by
-- 0067 for bespoke commissions) fires on status transitions INTO
-- 'complete'. The guard clause only checks that `old.status` wasn't
-- already 'complete', so if a case ever leaves 'complete' (e.g. an
-- admin reverts a bad complete via direct SQL, or a future workflow
-- allows re-opening) and comes back, the trigger fires again and
-- inserts a second 'earning' row - the accountant gets paid twice
-- for the same case.
--
-- This has not happened in practice because today nothing moves a
-- case out of 'complete'. But that invariant is a workflow
-- convention, not a DB-enforced rule, so one accidental UPDATE on
-- the admin side is the whole safeguard. We back it up at the
-- schema level.
--
-- Fix (DB-level guard): a partial unique index on (case_id) where
-- type = 'earning'. At most one earning row per case, enforced by
-- Postgres regardless of what the trigger or any ad-hoc write does.
--
-- Fix (trigger-level graceful): INSERT ... ON CONFLICT DO NOTHING
-- so a repeat trigger fire silently no-ops instead of raising and
-- rolling back the cases.status flip. The unique index is the
-- actual safety net; the ON CONFLICT keeps the user-facing
-- "mark complete" action from failing on a race or a buggy retry.
--
-- Note on existing data: the trigger today only runs on a true
-- transition into 'complete', and no path moves a case back out,
-- so there should be zero cases with multiple earning rows. If
-- this index creation fails, the correct response is to
-- reconcile those rows manually (keep the earlier, delete the
-- duplicate) rather than relax the constraint - the whole point
-- here is the invariant.

create unique index if not exists wallet_tx_one_earning_per_case
  on public.wallet_transactions (case_id)
  where type = 'earning' and case_id is not null;

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
      -- ON CONFLICT DO NOTHING against the (case_id) WHERE type =
      -- 'earning' partial unique index added above. The actual DB
      -- safety is the index; this clause just lets the user-facing
      -- status flip succeed even if a trigger retry would otherwise
      -- fail on the duplicate.
      insert into public.wallet_transactions
        (accountant_id, case_id, type, amount_pence, status)
      values (new.accountant_id, new.id, 'earning', v_amount, 'available')
      on conflict (case_id) where type = 'earning' do nothing;
    end if;
  end if;
  return new;
end;
$$;
