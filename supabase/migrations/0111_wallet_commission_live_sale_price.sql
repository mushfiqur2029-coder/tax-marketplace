-- Accountant commission: use the live sale price, not a stale baked-in
-- figure.
--
-- on_case_complete_credit_wallet() computed the non-bespoke commission
-- from a fixed pence figure hardcoded per tier in a CASE/WHEN block.
-- Those figures were each written at some point in the past, based on
-- whatever the tier's regular price was at the time. When admin later
-- put a tier on sale (or just changed its price), the hardcoded figure
-- never moved: the accountant kept being paid 50% of the OLD price,
-- not 50% of what the client actually paid. Reported case: PCH
-- (uber_phv_automated) is £150 regular / £89 on sale, but the hardcoded
-- table didn't even have an entry for that tier id (it still used an
-- older "uber_driver" id), so every PCH completion silently fell
-- through to a stale/wrong figure rather than reflecting the sale
-- price at all.
--
-- Fix: for the non-bespoke path, read public.service_catalog for the
-- tier at completion time and pay 50% of sale_price_gbp when one is
-- set, else 50% of price_gbp. This always reflects whatever price is
-- live in the catalog right now, so a future sale starting or ending
-- needs no function edit.
--
-- The bespoke path (custom_fee_pence is not null -> custom_fee_pence/2)
-- and the manual-override path (accountant_commission_pence) are
-- unchanged. Applied live via apply_migration on 2026-10-21; this file
-- tracks that change.

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
      -- Bespoke path (admin-created, custom_fee_pence set). Left exactly
      -- as it was: 50% of the admin-entered bespoke fee. Do not touch.
      v_amount := new.custom_fee_pence / 2;
    else
      -- Flat-fee tiers (every non-bespoke tier, PCH automated included):
      -- 50% of what the client actually paid, read live from
      -- public.service_catalog at completion time. See migration header
      -- for why this replaced the old hardcoded CASE/WHEN table.
      select price_gbp, sale_price_gbp
        into v_price_gbp, v_sale_gbp
        from public.service_catalog
       where id = new.tier;
      v_amount := round(coalesce(v_sale_gbp, v_price_gbp, 0) * 100 * 0.5);
    end if;
    if coalesce(new.is_urgent, false) then
      v_amount := v_amount + (coalesce(new.urgent_fee_pence, 0) / 2);
    end if;
    if v_amount > 0 then
      -- ON CONFLICT predicate must match wallet_tx_one_earning_per_case's
      -- index predicate EXACTLY (type = 'earning' AND case_id IS NOT NULL),
      -- or Postgres can't infer the constraint and the whole status flip
      -- fails with "no unique or exclusion constraint matching the ON
      -- CONFLICT specification".
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
