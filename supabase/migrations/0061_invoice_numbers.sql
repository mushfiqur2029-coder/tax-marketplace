-- Branded invoice PDFs for the payment-receipt email flow.
--
-- Numbering: one monotonic sequence across all time + a year-prefix
-- for human readability. Format: SL-YYYY-NNNNNN (6-digit zero-pad).
-- Example progression as payments land:
--   SL-2026-000001
--   SL-2026-000002
--   SL-2027-000003    ← year prefix updates, sequence keeps counting
--
-- The sequence is NOT reset annually on purpose. Resetting would mean
-- the January rollover needs its own carefully-timed job; a single
-- monotonic counter is simpler and HMRC rules only require
-- uniqueness, not year-local sequential-ness. Gaps from rolled-back
-- transactions are expected and acceptable.
--
-- Atomicity: a BEFORE UPDATE trigger assigns NEW.invoice_number via
-- nextval() in the same transaction that flips stripe_payment_status
-- (cases) or status (case_addons) to the paid state. Postgres
-- sequences are MVCC-safe — two concurrent transactions each get a
-- unique value with no row-level locking. The columns themselves are
-- UNIQUE constrained as a belt-and-braces defense.

create sequence if not exists public.sl_invoice_seq
  start with 1
  increment by 1
  no cycle;

create or replace function public.sl_generate_invoice_number()
returns text language sql volatile as $$
  select 'SL-' ||
         to_char((now() at time zone 'Europe/London'), 'YYYY') ||
         '-' ||
         lpad(nextval('public.sl_invoice_seq')::text, 6, '0');
$$;

-- cases column + trigger ---------------------------------------------
alter table public.cases
  add column if not exists invoice_number text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'cases_invoice_number_key'
  ) then
    alter table public.cases
      add constraint cases_invoice_number_key unique (invoice_number);
  end if;
end $$;

create or replace function public.assign_case_invoice_number()
returns trigger language plpgsql as $$
begin
  if new.stripe_payment_status = 'succeeded'
     and (old.stripe_payment_status is distinct from 'succeeded')
     and new.invoice_number is null then
    new.invoice_number := public.sl_generate_invoice_number();
  end if;
  return new;
end $$;

drop trigger if exists cases_assign_invoice_number_trg on public.cases;
create trigger cases_assign_invoice_number_trg
  before update on public.cases
  for each row execute function public.assign_case_invoice_number();

-- case_addons column + trigger ---------------------------------------
alter table public.case_addons
  add column if not exists invoice_number text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'case_addons_invoice_number_key'
  ) then
    alter table public.case_addons
      add constraint case_addons_invoice_number_key unique (invoice_number);
  end if;
end $$;

create or replace function public.assign_case_addon_invoice_number()
returns trigger language plpgsql as $$
begin
  if new.status = 'paid'
     and (old.status is distinct from 'paid')
     and new.invoice_number is null then
    new.invoice_number := public.sl_generate_invoice_number();
  end if;
  return new;
end $$;

drop trigger if exists case_addons_assign_invoice_number_trg on public.case_addons;
create trigger case_addons_assign_invoice_number_trg
  before update on public.case_addons
  for each row execute function public.assign_case_addon_invoice_number();
