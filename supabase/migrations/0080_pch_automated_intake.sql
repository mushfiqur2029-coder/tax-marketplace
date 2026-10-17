-- Phase 2 schema for the Uber / PHV automated workflow. Overlays the
-- existing cases + case_documents + case_status machinery:
--   * new tier value `uber_phv_automated` (manual tiers unchanged)
--   * one row per case in pch_cases (client details, approval record,
--     engine snapshot cache)
--   * child tables for the three dynamic input groups: income lines,
--     expense lines, vehicle (vehicle is 1:1 so a single row)
--   * pch_doc_checklist tracks which of the 24 doc slots a case has
--     filled (requirement_key on case_documents maps to the slot)
--   * pch_accountant_checks tracks the 33 review items
--   * pch_overrides is the audit trail for accountant overrides of any
--     engine-calculated figure (who, when, old, new, reason)
--
-- All tables carry RLS: client reads own, accountant reads assigned,
-- admin reads all. Service role bypasses for server-side writes.
--
-- This migration is additive and reversible: dropping these tables
-- plus the new enum value leaves the rest of the app untouched.

-- ---- New tier value --------------------------------------------------

alter type case_tier add value if not exists 'uber_phv_automated';

-- ---- Per-case PCH head row ------------------------------------------

create table if not exists public.pch_cases (
  case_id uuid primary key references public.cases(id) on delete cascade,
  tax_year text not null default '2025/26',

  -- Tab 1 Client details
  cl_name text,
  cl_utr text,
  cl_nino text,
  cl_dob date,
  cl_address text,
  cl_postcode text,
  cl_phone text,
  cl_email text,
  cl_address_changed boolean default false,
  cl_licensing_authority text,
  cl_platforms text,
  cl_start_date date,
  cl_stop_date date,

  -- Other income (tab 1 continued)
  employment_income_pence integer default 0,
  paye_pence integer default 0,
  rental_profit_pence integer default 0,
  bank_interest_pence integer default 0,
  benefits_note text,
  marriage_allowance_status text
    check (marriage_allowance_status in ('None','Transferring','Receiving'))
    default 'None',
  spouse_details text,
  personal_pension_net_pence integer default 0,
  gift_aid_net_pence integer default 0,
  student_loan_plan text,

  -- Payments on account (tab 1)
  poa1_due_pence integer default 0,
  poa2_due_pence integer default 0,
  poa_reduced boolean default false,
  poa1_paid_pence integer default 0,
  poa2_paid_pence integer default 0,

  -- MTD / rental
  gross_rent_received_pence integer default 0,
  last_year_qi_pence integer default 0,

  -- VAT
  vat_registered boolean default false,
  vat_registration_date date,
  vat_scheme text,

  -- Approval record (client-side sign-off)
  client_approval_name text,       -- typed name
  client_approval_at timestamptz,  -- timestamp
  client_approval_ip text,         -- lightweight audit
  client_approval_version integer, -- which snapshot was approved

  -- Latest engine-run snapshot (kept so the final figures survive
  -- after the inputs are deleted or edited; what-you-see-is-what-you-
  -- signed). JSON matches the TaxEngineOutput shape; we store it so
  -- the SA boxes screen and the audit log show the exact figures the
  -- client approved.
  engine_snapshot jsonb,
  engine_snapshot_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists pch_cases_set_updated_at on public.pch_cases;
create trigger pch_cases_set_updated_at
  before update on public.pch_cases
  for each row execute function set_updated_at();

-- ---- Income lines (tab 2) -------------------------------------------

create table if not exists public.pch_income_lines (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  source text not null,                   -- "Uber - rides", "Bolt", "Cash fares", etc.
  gross_takings_pence integer not null default 0,
  platform_fee_pence integer not null default 0,
  on_trip_miles integer not null default 0,
  dead_miles integer not null default 0,
  evidence text,                          -- "Platform annual summary", "Manual entry", etc.
  notes text,
  line_type text not null                 -- Fares / Other / VAT
    check (line_type in ('Fares','Other','VAT')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists pch_income_lines_case_idx
  on public.pch_income_lines (case_id, sort_order);

-- ---- Expense lines (tab 3) ------------------------------------------

create table if not exists public.pch_expense_lines (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  label text not null,                    -- "Fuel", "Insurance", etc.
  amount_paid_pence integer not null default 0,
  evidence text,                          -- "Bank statement", "Receipt", "Estimate (E2)"
  car_cost text not null                  -- Yes / No / Phone
    check (car_cost in ('Yes','No','Phone')),
  category text not null                  -- P&L heading (10 options from workbook)
    check (category in (
      'Vehicle running costs',
      'Vehicle hire, lease & finance',
      'Congestion, ULEZ, tolls & parking',
      'Licences & compliance',
      'Phone & technology',
      'Platform & card fees',
      'Finance & bank charges',
      'Accountancy & insurance',
      'Other expenses',
      'VAT paid (Flat Rate Scheme)'
    )),
  sa103s_box integer not null
    check (sa103s_box in (12, 14, 16, 17, 18, 19)),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists pch_expense_lines_case_idx
  on public.pch_expense_lines (case_id, sort_order);

-- ---- Vehicle (tab 4) ------------------------------------------------

create table if not exists public.pch_vehicle (
  case_id uuid primary key references public.cases(id) on delete cascade,
  status text check (status in (
    'Owned outright','Bought on HP / loan','Rented weekly (PCO hire)','Leased'
  )),
  fuel text check (fuel in ('Petrol','Diesel','Hybrid','Electric')),
  make_model text,
  registration text,
  co2_gpkm integer,
  bought_this_year boolean default false,
  purchase_date date,
  purchase_price_pence integer,
  new_or_used text check (new_or_used in ('New','Used')),
  disposed boolean default false,
  disposal_proceeds_pence integer,
  odo_start integer,
  odo_end integer,
  other_business_miles integer default 0,
  phone_business_pct numeric(4,2),              -- 0..1
  wdv_brought_forward_pence integer default 0,  -- accountant fills
  previous_method text check (previous_method in (
    'Simplified mileage','Actual costs (capital allowances claimed)','First year'
  )),
  business_pct_override numeric(4,2),           -- 0..1, blank = use mileage
  ca_rate_override numeric(4,2),
  method_choice text check (method_choice in ('Simplified mileage','Actual costs')),
  real_mpg numeric(5,2),
  fuel_price_per_litre numeric(5,2)
);

-- ---- 24-item document checklist state -------------------------------

-- Document slot catalogue (static reference data). Insert once; shared
-- across every PCH case. requirement_key on case_documents links an
-- uploaded file back to its slot.
create table if not exists public.pch_doc_slots (
  code text primary key,                  -- "PCH-01" .. "PCH-24"
  section text not null,                  -- "Income", "Vehicle", etc.
  display_name text not null,
  why_we_need_it text,
  accepted_formats text not null,         -- "PDF/JPG/PNG" or finer
  required_rule text not null,            -- "Required" or conditional phrase
  sort_order integer not null
);

-- Per-case per-slot status cache (not strictly needed; derivable from
-- case_documents + the slot catalogue; kept so a client can mark a
-- slot "N/A" with a note even when no file was uploaded).
create table if not exists public.pch_doc_status (
  case_id uuid not null references public.cases(id) on delete cascade,
  slot_code text not null references public.pch_doc_slots(code),
  status text not null                    -- Uploaded / Not applicable / Awaiting
    check (status in ('Uploaded','Not applicable','Awaiting')) default 'Awaiting',
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id),
  primary key (case_id, slot_code)
);

-- Seed the 24 slots verbatim from Client Documents – PCH xlsx.
insert into public.pch_doc_slots
  (code, section, display_name, why_we_need_it, accepted_formats, required_rule, sort_order)
values
  ('PCH-01','Income','Platform annual tax summary (Uber / Bolt / FreeNow)','Gross fares, fees, mileage (SA103S box 9)','PDF','Required',10),
  ('PCH-02','Income','Weekly / monthly platform statements','Rebuild the tax-year income if no annual summary','PDF','If no annual summary',20),
  ('PCH-03','Income','Cash and account-work log','Income not paid through an app','Excel / photo of notebook','If any cash work',30),
  ('PCH-04','Vehicle','Vehicle insurance schedule (hire & reward)','Insurance cost (box 12)','PDF','Required',40),
  ('PCH-05','Vehicle','V5C log book','Ownership, CO2 (capital allowance rate), registration date','Photo','Required',50),
  ('PCH-06','Vehicle','Purchase invoice and HP / PCP finance statement','Capital allowances; finance interest','PDF','If bought / financed',60),
  ('PCH-07','Vehicle','Car rental / PCO hire agreement and payments','Rental cost (box 12)','PDF','If renting',70),
  ('PCH-08','Vehicle','MOT history (odometer readings)','Total miles and business-use %','Screenshot from GOV.UK','Required',80),
  ('PCH-09','Running costs','Fuel / charging – receipts or highlighted bank lines','Fuel cost (box 12)','Photo / statement','Required (actual-cost method)',90),
  ('PCH-10','Running costs','Repairs, servicing, tyres, MOT and road tax receipts','Repairs (box 12)','Photo / PDF','If paid',100),
  ('PCH-11','Running costs','Congestion charge, ULEZ and parking receipts','Allowable charges (not fines)','TfL account export','If paid',110),
  ('PCH-12','Licences','PHV driver and vehicle licence fees','Licence costs (box 19)','Receipt / email','Required',120),
  ('PCH-13','Other costs','Mobile phone bill','Phone cost × business %','PDF','If claiming',130),
  ('PCH-14','Bank','Bank statements – account receiving platform payouts','Check all income; spot cash deposits','PDF','Required',140),
  ('PCH-15','VAT','Uber VAT statements (VAT-registered TfL drivers only)','VAT top-up and VAT return figures','PDF','If VAT registered',150),
  ('PCH-16','Employment','P60 for every job held at 5 April 2026','Pay and tax deducted (SA102 boxes 1-2)','PDF / photo','If employed',160),
  ('PCH-17','Employment','P45 for any job that ended in the year','Pay and tax for jobs left during the year','PDF / photo','If a job ended',170),
  ('PCH-18','Other income','Bank / building society interest certificate','Untaxed interest (SA100 TR3 box 2)','PDF','If interest received',180),
  ('PCH-19','Other income','Student loan statement / plan type','Student loan repayment due through Self Assessment','Screenshot of SLC account','If has a student loan',190),
  ('PCH-20','HMRC history','Last year''s SA302 / tax calculation','Payments on account due; losses and figures brought forward','PDF','Existing clients',200),
  ('PCH-21','HMRC history','Proof of payments made to HMRC','Payments on account actually paid; balancing payment','PDF / screenshot','If payments on account were due',210),
  ('PCH-22','HMRC history','Any HMRC letters (compliance, nudge, coding)','Open enquiries and HMRC''s own data','PDF / photo','If received',220),
  ('PCH-23','Sign-off','Signed approval of draft accounts','Client confirms the accounts before filing','Signed PDF / e-sign','Required',230),
  ('PCH-24','Identity','Photo ID and proof of address','Anti-money-laundering checks only','Photo','New clients',240)
on conflict (code) do update set
  section = excluded.section,
  display_name = excluded.display_name,
  why_we_need_it = excluded.why_we_need_it,
  accepted_formats = excluded.accepted_formats,
  required_rule = excluded.required_rule,
  sort_order = excluded.sort_order;

-- ---- 33-item accountant checklist state -----------------------------

create table if not exists public.pch_check_items (
  item_number integer primary key,
  area text not null,                     -- Identity, Income, Expenses, Car, etc.
  description text not null,
  sort_order integer not null
);

create table if not exists public.pch_check_status (
  case_id uuid not null references public.cases(id) on delete cascade,
  item_number integer not null references public.pch_check_items(item_number),
  status text not null
    check (status in ('Done','N/A','Not started')) default 'Not started',
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id),
  primary key (case_id, item_number)
);

insert into public.pch_check_items (item_number, area, description, sort_order) values
  (1,'Identity','UTR, NINO, date of birth and postcode match HMRC records',10),
  (2,'Identity','Agent authorisation in place; engagement letter signed',20),
  (3,'Income','Each app''s annual summary attached; turnover = ''Total revenue'' (Uber) or gross fares',30),
  (4,'Income','Income matches what the platform reported to HMRC (digital platform reporting)',40),
  (5,'Income','Platforms with nil income confirmed in writing by the client',50),
  (6,'Income','Card machine, cash and account work included; any reduction has a written reason',60),
  (7,'Income','VAT-registered clients: VAT top-up and Flat Rate payments both included',70),
  (8,'Expenses','Every expense line has evidence or is marked Estimate with a reason',80),
  (9,'Expenses','All dates fall between 6 April 2025 and 5 April 2026',90),
  (10,'Expenses','Fines and PCNs removed; no car purchase or HP capital in expenses',100),
  (11,'Expenses','Often-missed costs asked about: PCO rental, DBS/medical, VED on EVs, breakdown',110),
  (12,'Car','Business use % evidenced by mileage (app miles + MOT odometer); same % everywhere',120),
  (13,'Car','CO2 figure recorded; allowance rate 18% / 6% / 100% FYA correct',130),
  (14,'Car','WDV brought forward agrees to last year''s carried forward',140),
  (15,'Car','Mileage vs actual compared; method allowed for this car',150),
  (16,'Car','Sale or part-exchange: balancing allowance or charge entered',160),
  (17,'Review','Each P&L line compared with 2024/25; changes over 25% explained',170),
  (18,'Review','Ratios inside the normal range or explained (tab 5)',180),
  (19,'Reliefs','Pension contributions, Gift Aid and Marriage Allowance asked about and claimed',190),
  (20,'Reliefs','Client near £50,270 or £100,000: pension planning discussed',200),
  (21,'Reliefs','Profit under £6,845: voluntary Class 2 offered',210),
  (22,'VAT','TfL-licensed Uber client: VAT registration test (tab 7) run and recorded',220),
  (23,'MTD','MTD status read: 2024/25 income over £50,000 = in MTD from 6 Apr 2026',230),
  (24,'MTD','2025/26 income over £50,000 or £30,000: client told MTD starts 6 Apr 2027',240),
  (25,'POA','2025/26 payments on account taken from the 2024/25 SA302 and agreed to HMRC statement',250),
  (26,'POA','Unpaid payments on account flagged to client; balancing agrees to SA302',260),
  (27,'Evidence','Every estimate has a method code (tab 3b), a written working, and client confirmation',270),
  (28,'Approval','P&L PDF approved in writing and saved; report dated',280),
  (29,'Return','SA103S / SA100 boxes entered from tab 8; SA302 agrees to tab 6',290),
  (30,'Return','Payments on account reviewed; reduction claim only if 2026/27 profit will genuinely fall',300),
  (31,'Return','Repayment bank details in client''s name or nominee section completed',310),
  (32,'Deliver','SA302, payment dates and HMRC reference sent to client; submission receipt saved',320),
  (33,'Deliver','Client reminded: tax check code for PCO licence renewal uses the 2025/26 year',330)
on conflict (item_number) do update set
  area = excluded.area,
  description = excluded.description,
  sort_order = excluded.sort_order;

-- ---- Override audit log ---------------------------------------------

-- Every time an accountant overrides an engine-calculated figure, we
-- insert a row here. field_path is a dotted path into the engine output
-- (e.g. "pl.turnover", "sa103s.box31_totalTaxableProfits"); old_value
-- and new_value are stringified for stable storage.
create table if not exists public.pch_overrides (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  field_path text not null,
  old_value text,
  new_value text,
  reason text,
  overridden_by uuid references public.users(id),
  overridden_at timestamptz not null default now()
);

create index if not exists pch_overrides_case_idx
  on public.pch_overrides (case_id, overridden_at desc);

-- ---- RLS: client reads own, accountant reads assigned, admin all ----

alter table public.pch_cases enable row level security;
alter table public.pch_income_lines enable row level security;
alter table public.pch_expense_lines enable row level security;
alter table public.pch_vehicle enable row level security;
alter table public.pch_doc_status enable row level security;
alter table public.pch_check_status enable row level security;
alter table public.pch_overrides enable row level security;

-- Reference tables are world-readable (static catalogues).
alter table public.pch_doc_slots enable row level security;
alter table public.pch_check_items enable row level security;

drop policy if exists "pch_doc_slots_read" on public.pch_doc_slots;
create policy "pch_doc_slots_read" on public.pch_doc_slots
  for select using (true);
drop policy if exists "pch_check_items_read" on public.pch_check_items;
create policy "pch_check_items_read" on public.pch_check_items
  for select using (true);

-- Helper: EXISTS a case this user owns or is assigned to.
-- Reused by all per-case tables below.

-- pch_cases
drop policy if exists "pch_cases_select" on public.pch_cases;
create policy "pch_cases_select" on public.pch_cases
  for select using (
    exists (
      select 1 from public.cases c
      where c.id = pch_cases.case_id
        and (c.client_id = (select auth.uid()) or c.accountant_id = (select auth.uid()))
    )
  );

-- Line tables: same visibility; writes go through server actions
-- (service role bypasses, no explicit insert/update/delete policies).
drop policy if exists "pch_income_lines_select" on public.pch_income_lines;
create policy "pch_income_lines_select" on public.pch_income_lines
  for select using (
    exists (
      select 1 from public.cases c
      where c.id = pch_income_lines.case_id
        and (c.client_id = (select auth.uid()) or c.accountant_id = (select auth.uid()))
    )
  );

drop policy if exists "pch_expense_lines_select" on public.pch_expense_lines;
create policy "pch_expense_lines_select" on public.pch_expense_lines
  for select using (
    exists (
      select 1 from public.cases c
      where c.id = pch_expense_lines.case_id
        and (c.client_id = (select auth.uid()) or c.accountant_id = (select auth.uid()))
    )
  );

drop policy if exists "pch_vehicle_select" on public.pch_vehicle;
create policy "pch_vehicle_select" on public.pch_vehicle
  for select using (
    exists (
      select 1 from public.cases c
      where c.id = pch_vehicle.case_id
        and (c.client_id = (select auth.uid()) or c.accountant_id = (select auth.uid()))
    )
  );

drop policy if exists "pch_doc_status_select" on public.pch_doc_status;
create policy "pch_doc_status_select" on public.pch_doc_status
  for select using (
    exists (
      select 1 from public.cases c
      where c.id = pch_doc_status.case_id
        and (c.client_id = (select auth.uid()) or c.accountant_id = (select auth.uid()))
    )
  );

drop policy if exists "pch_check_status_select" on public.pch_check_status;
create policy "pch_check_status_select" on public.pch_check_status
  for select using (
    exists (
      select 1 from public.cases c
      where c.id = pch_check_status.case_id
        and (c.client_id = (select auth.uid()) or c.accountant_id = (select auth.uid()))
    )
  );

drop policy if exists "pch_overrides_select" on public.pch_overrides;
create policy "pch_overrides_select" on public.pch_overrides
  for select using (
    exists (
      select 1 from public.cases c
      where c.id = pch_overrides.case_id
        and (c.client_id = (select auth.uid()) or c.accountant_id = (select auth.uid()))
    )
  );

-- Publish bookings-style realtime so the accountant dashboard can see
-- intake changes live if the client is editing in another tab.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename in ('pch_cases','pch_income_lines','pch_expense_lines','pch_vehicle','pch_check_status','pch_overrides')
  ) then
    execute 'alter publication supabase_realtime add table public.pch_cases';
    execute 'alter publication supabase_realtime add table public.pch_income_lines';
    execute 'alter publication supabase_realtime add table public.pch_expense_lines';
    execute 'alter publication supabase_realtime add table public.pch_vehicle';
    execute 'alter publication supabase_realtime add table public.pch_check_status';
    execute 'alter publication supabase_realtime add table public.pch_overrides';
  end if;
end $$;
