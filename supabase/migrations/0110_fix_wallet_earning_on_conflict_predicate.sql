-- Fix "Mark complete" failing with: there is no unique or exclusion
-- constraint matching the ON CONFLICT specification.
--
-- on_case_complete_credit_wallet() (trigger case_complete_credit on
-- public.cases, fires on status -> 'complete') posts the accountant's
-- commission into wallet_transactions, guarding against a duplicate
-- post with:
--
--   on conflict (case_id) where type = 'earning' do nothing;
--
-- The actual partial unique index on wallet_transactions is:
--
--   wallet_tx_one_earning_per_case ... (case_id)
--     where (type = 'earning'::wallet_transaction_type) and (case_id is not null)
--
-- Postgres requires an ON CONFLICT ... WHERE predicate to match an
-- existing partial unique index's predicate expression-for-expression
-- (including the enum cast) to infer it as the arbiter. The trigger's
-- predicate was missing both the explicit ::wallet_transaction_type
-- cast and the "and case_id is not null" clause, so inference failed
-- every time the insert actually hit the conflict path (i.e. every
-- real "mark complete" click), aborting the whole status-update
-- transaction with the error above and leaving the case stuck on
-- 'filed' with no way to complete it. It worked on disposable test
-- fixtures only because they happened not to exercise this path first.
--
-- Fix: make the ON CONFLICT predicate match the index textually.
-- Applied live via apply_migration on 2026-10-21; this file brings
-- the tracked migration history back in sync with production so a
-- fresh environment or a db reset doesn't regress. Function body
-- (including the tier commission table) copied verbatim from the
-- live pg_proc source to avoid any transcription drift.

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
    if new.accountant_commission_pence is not null then
      v_amount := new.accountant_commission_pence;
    elsif new.custom_fee_pence is not null then
      v_amount := new.custom_fee_pence / 2;
    else
      v_amount := case new.tier
        when 'uber_driver'            then 9950
        when 'cis_subcontractor'      then 14950
        when 'sole_trader'            then 9950
        when 'landlord_small'         then 12500
        when 'non_resident_landlord'  then 19950
        when 'gig_worker'             then 9950
        when 'freelancer_consultant'  then 9950
        when 'landlord_multi'         then 29950
        when 'complex_international'  then 50000
        when 'basic'                  then 4950
        when 'standard'               then 7450
        when 'premium'                then 17450
        when 'dormant'                then 7500
        when 'non_vat_reg'            then 35000
        when 'vat_reg'                then 50000
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
      -- ON CONFLICT predicate must match wallet_tx_one_earning_per_case's
      -- index predicate EXACTLY (type = 'earning' AND case_id IS NOT NULL),
      -- or Postgres can't infer the constraint and the whole status flip
      -- fails with "no unique or exclusion constraint matching the ON
      -- CONFLICT specification". The prior version of this function was
      -- missing the case_id IS NOT NULL half, which is why marking a real
      -- case complete failed live even though it worked on disposable
      -- test fixtures where this code path happened not to be hit first.
      insert into public.wallet_transactions
        (accountant_id, case_id, type, amount_pence, status)
      values (new.accountant_id, new.id, 'earning', v_amount, 'available')
      on conflict (case_id) where type = 'earning'::wallet_transaction_type and case_id is not null
      do nothing;
    end if;
  end if;

  return new;
end
$$;
