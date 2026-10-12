-- 0066: Two-stage payment for admin-created bespoke engagements.
--
-- Admin now sets a deposit as well as a total fee on bespoke-case
-- creation (vat_plus_accounts_bespoke). The deposit is paid upfront
-- via Stripe before work starts (reusing the existing payment
-- columns on cases: stripe_payment_status / stripe_payment_id /
-- stripe_checkout_session_id, since their semantics are already
-- "payment required before work can begin"). The balance is paid at
-- the end: the moment the client clicks Approve on the prepared
-- work we open a second Stripe checkout for balance_pence, and the
-- client_approval -> filed transition is gated on that balance
-- payment succeeding.
--
-- Columns added:
--
--   deposit_pence                       integer      the agreed deposit, set at
--                                                    bespoke case creation.
--                                                    NULL for every non-bespoke
--                                                    case and for legacy
--                                                    bespoke cases created
--                                                    before this migration
--                                                    (they continue on the
--                                                    single-fee path via
--                                                    custom_fee_pence).
--
--   balance_pence                       integer      total minus deposit, also
--                                                    set at bespoke case
--                                                    creation. Stored
--                                                    redundantly (= custom_fee_pence
--                                                    - deposit_pence) so UI /
--                                                    PDFs can display the
--                                                    balance without arithmetic
--                                                    at every read site.
--
--   balance_payment_status              text         'pending' until the
--                                                    balance webhook flips it
--                                                    to 'succeeded'. NULL for
--                                                    cases that have no
--                                                    balance (every non-bespoke
--                                                    + legacy bespoke).
--
--   balance_stripe_payment_id           text         PaymentIntent id from the
--                                                    balance checkout.
--
--   balance_stripe_checkout_session_id  text         CheckoutSession id written
--                                                    at the moment the client's
--                                                    approve action creates the
--                                                    balance session; webhook
--                                                    matches on it for
--                                                    idempotency.
--
--   balance_paid_at                     timestamptz  when the balance payment
--                                                    succeeded.
--
-- Rule enforced in TS (createBespokeCaseFromEnquiryAction): deposit > 0
-- and deposit < total. Reflected here as a CHECK constraint that fires
-- only when deposit_pence IS NOT NULL so non-bespoke cases are
-- unaffected.
--
-- No RLS change: the client already has the UPDATE windows they need
-- from 0002/0014/0039/0046/0063, and all balance-column writes go
-- through the admin (service-role) Stripe webhook, which bypasses RLS.

alter table public.cases
  add column if not exists deposit_pence integer,
  add column if not exists balance_pence integer,
  add column if not exists balance_payment_status text,
  add column if not exists balance_stripe_payment_id text,
  add column if not exists balance_stripe_checkout_session_id text,
  add column if not exists balance_paid_at timestamptz,
  add column if not exists balance_invoice_number text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'cases_balance_invoice_number_key'
  ) then
    alter table public.cases
      add constraint cases_balance_invoice_number_key unique (balance_invoice_number);
  end if;
end $$;

-- Balance invoice number assigned atomically when
-- balance_payment_status flips to 'succeeded'. Mirrors 0061's
-- assign_case_invoice_number trigger shape so the two invoices
-- (deposit + balance) each get their own SL-YYYY-NNNNNN number from
-- the same monotonic sequence.
create or replace function public.assign_case_balance_invoice_number()
returns trigger language plpgsql as $$
begin
  if new.balance_payment_status = 'succeeded'
     and (old.balance_payment_status is distinct from 'succeeded')
     and new.balance_invoice_number is null then
    new.balance_invoice_number := public.sl_generate_invoice_number();
  end if;
  return new;
end $$;

drop trigger if exists cases_assign_balance_invoice_number_trg on public.cases;
create trigger cases_assign_balance_invoice_number_trg
  before update on public.cases
  for each row execute function public.assign_case_balance_invoice_number();

-- Both split amounts must be positive when set; their sum must match
-- custom_fee_pence. The second clause tolerates NULL on either side
-- (constraint only applies to a fully populated split, so legacy
-- rows with no split are fine).
do $$ begin
  alter table public.cases
    add constraint cases_bespoke_split_positive
    check (
      (deposit_pence is null and balance_pence is null)
      or (deposit_pence > 0 and balance_pence > 0)
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.cases
    add constraint cases_bespoke_split_sums_to_total
    check (
      deposit_pence is null
      or balance_pence is null
      or custom_fee_pence is null
      or deposit_pence + balance_pence = custom_fee_pence
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.cases
    add constraint cases_balance_payment_status_values
    check (
      balance_payment_status is null
      or balance_payment_status in ('pending', 'succeeded')
    );
exception when duplicate_object then null; end $$;

-- Fast lookup for the stripe webhook when matching the balance
-- checkout session id back to a case.
create index if not exists cases_balance_stripe_checkout_session_id_idx
  on public.cases (balance_stripe_checkout_session_id)
  where balance_stripe_checkout_session_id is not null;
