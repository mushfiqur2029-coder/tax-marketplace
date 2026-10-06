-- Admin-created bespoke case from an enquiry. Three schema changes:
--
--   1. cases.custom_fee_pence — per-row override. When set, every
--      price-reading surface (Stripe amount, engagement letter, checkout
--      display, payments history, wallet commission split) prefers this
--      over the tier catalogue priceGbp. Only ever written by the admin
--      createBespokeCaseFromEnquiryAction server action.
--
--   2. cases.service_enquiry_id — audit trail link back to the
--      originating enquiry so the admin UI can show "case created from
--      enquiry X" and the client can see the quote in the context of
--      the enquiry they submitted.
--
--   3. New case_tier enum value 'vat_plus_accounts_bespoke'. Distinct
--      identity for admin-created bespoke engagements so tier.title
--      reads correctly ("VAT Registered + Accounts (bespoke)") instead
--      of inheriting the flat-fee vat_reg title throughout.
--
-- The commission trigger is updated to prefer custom_fee_pence / 2
-- when set, keeping the 50/50 split rule but letting it apply to any
-- bespoke amount the admin chooses.

alter table public.cases
  add column if not exists custom_fee_pence integer
    check (custom_fee_pence is null or custom_fee_pence > 0);

alter table public.cases
  add column if not exists service_enquiry_id uuid
    references public.service_enquiries(id) on delete set null;

create index if not exists cases_service_enquiry_id_idx
  on public.cases (service_enquiry_id);

do $$ begin
  alter type case_tier add value if not exists 'vat_plus_accounts_bespoke';
end $$;

-- Wallet commission trigger: 50/50 of the effective fee (custom when
-- set, tier catalogue otherwise). Urgent branch unchanged — still
-- adds urgent_fee_pence / 2 segment-agnostically.
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
    -- Custom override wins when set — the admin picked the fee for
    -- this bespoke engagement, split that in half, done. Falls through
    -- to the tier catalogue for every other case.
    if new.custom_fee_pence is not null then
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
