-- Service catalogue table. Replaces the hardcoded PLAN_TIERS array in
-- src/lib/plans.ts as the source of truth for display fields (title,
-- tagline, description, features, price). Business-logic fields
-- (id/group/requires_enquiry/admin_create_only) are also stored here
-- for completeness, but the admin UI treats them as read-only — a
-- genuine new service type needs a code migration (new TierId enum
-- value + checklist mapping + commission trigger branch) and would
-- be introduced via a seed insert here as part of that migration.
--
-- Immutability of price: new cases snapshot the current price into
-- cases.custom_fee_pence at insert time (see createCaseAction and
-- createBespokeCaseFromEnquiryAction), so admin price edits only
-- affect NEW signups. Historic cases are backfilled by 0058.
--
-- active=false hides a service from new signups while preserving
-- history — same semantic as addon_catalog.active.

create table if not exists public.service_catalog (
  id text primary key,
  "group" text not null check ("group" in ('personal', 'company')),
  title text not null,
  tagline text not null,
  description text,
  features text[],
  footer_line text,
  hero_line text,
  price_gbp integer not null default 0 check (price_gbp >= 0),
  original_gbp integer,
  save_gbp integer,
  price_display text,
  price_gbp_subtitle text,
  price_suffix text,
  price_per text,
  featured boolean not null default false,
  active boolean not null default true,
  display_order integer not null default 0,
  -- Business logic flags. Readonly in the admin UI; set here via
  -- seed data below and changed only by future migrations.
  requires_enquiry boolean not null default false,
  admin_create_only boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);

create index if not exists service_catalog_group_idx
  on public.service_catalog ("group");
create index if not exists service_catalog_active_order_idx
  on public.service_catalog (active, display_order);

alter table public.service_catalog enable row level security;
-- No public policies — admin-only, read + write via service role.

-- Publish to realtime so admin edits land live on the admin
-- catalogue page without requiring a reload.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'service_catalog'
  ) then
    execute 'alter publication supabase_realtime add table public.service_catalog';
  end if;
end
$$;

-- Seed with the current PLAN_TIERS data verbatim. On a fresh deploy
-- these ARE the source of truth; on an existing deploy, the admin can
-- edit them after this migration lands. ON CONFLICT DO NOTHING keeps
-- the migration idempotent — re-running won't clobber admin edits.

insert into public.service_catalog
  (id, "group", title, tagline, description, features, footer_line, price_gbp,
   price_gbp_subtitle, price_display, requires_enquiry, admin_create_only, display_order)
values
  ('uber_driver', 'personal',
    'Uber / private-hire drivers',
    'For Uber, Bolt, Addison Lee, and other private-hire drivers.',
    null,
    array[
      'Prepared and filed Self Assessment, signed off by a qualified accountant',
      'Mileage and allowable vehicle costs reviewed with you',
      'Platform fees, insurance, licensing claimed where allowable',
      'Accuracy guarantee + accountant message during filing'
    ],
    'Flat fee, no surprises.',
    199, 'one-off', null, false, false, 10),
  ('cis_subcontractor', 'personal',
    'CIS subcontractors',
    'Reconcile your deductions and claim what HMRC owes you.',
    null,
    array[
      'Prepared and filed Self Assessment, signed off by a qualified accountant',
      'CIS deductions reconciled and refund position calculated',
      'Vehicle, tools, and materials claimed where allowable',
      'Full HMRC letter + enquiry support'
    ],
    'Flat fee, no surprises.',
    299, 'one-off', null, false, false, 20),
  ('sole_trader', 'personal',
    'Sole trader / self-employed',
    'Sole traders and freelancers. All your allowable expenses captured.',
    null,
    array[
      'Prepared and filed Self Assessment, signed off by a qualified accountant',
      'Trading income and allowable expenses captured in full',
      'Cash-basis treatment where it suits your situation',
      'Accuracy guarantee + accountant message during filing'
    ],
    'Flat fee, no surprises.',
    199, 'one-off', null, false, false, 30),
  ('landlord_small', 'personal',
    'Landlord (1-2 properties)',
    'Rental income and allowable expenses, for one or two let properties.',
    null,
    array[
      'Prepared and filed Self Assessment, signed off by a qualified accountant',
      'Rental income and allowable expenses captured per property',
      'Mortgage interest treated under the current rules',
      'Repair vs improvement advice where it matters'
    ],
    'Flat fee, no surprises.',
    250, 'one-off', null, false, false, 40),
  ('non_resident_landlord', 'personal',
    'Non-resident landlord',
    'Living abroad with UK property. NRLS treatment under current rules.',
    null,
    array[
      'Prepared and filed Self Assessment, signed off by a qualified accountant',
      'Non-Resident Landlord Scheme (NRLS) treatment included',
      'Rental income, mortgage interest, and expenses captured',
      'Guidance on withholding tax and gross-payment status'
    ],
    'Flat fee, no surprises.',
    399, 'one-off', null, false, false, 50),
  ('gig_worker', 'personal',
    'Delivery / gig workers',
    'Deliveroo, Uber Eats, Amazon Flex, Just Eat. Gig income done right.',
    null,
    array[
      'Prepared and filed Self Assessment, signed off by a qualified accountant',
      'Platform earnings and allowable expenses captured',
      'Mileage and vehicle costs reviewed with you',
      'Accuracy guarantee + accountant message during filing'
    ],
    'Flat fee, no surprises.',
    199, 'one-off', null, false, false, 60),
  ('freelancer_consultant', 'personal',
    'Freelancer / consultant',
    'Freelance work, side projects, and consulting income in one return.',
    null,
    array[
      'Prepared and filed Self Assessment, signed off by a qualified accountant',
      'Freelance income and expenses captured in full',
      'Dividends, interest, and other side income included',
      'Accuracy guarantee + accountant message during filing'
    ],
    'Flat fee, no surprises.',
    199, 'one-off', null, false, false, 70),
  ('landlord_multi', 'personal',
    'Landlord (multiple properties)',
    'Portfolio landlords. Property-by-property and overall position.',
    null,
    array[
      'Prepared and filed Self Assessment, signed off by a qualified accountant',
      'Multi-property rental income and expenses captured',
      'Mortgage interest treated under the current rules',
      'Property-by-property profit/loss and tax position'
    ],
    'Flat fee, no surprises.',
    599, 'one-off', null, false, false, 80),
  ('complex_international', 'personal',
    'Complex foreign / international',
    'Foreign income, multiple residencies, or treaty positions.',
    null,
    array[
      'Prepared and filed Self Assessment, signed off by a qualified accountant',
      'Foreign income, remittance basis, and residency reviewed',
      'Double taxation relief considered where applicable',
      'Guidance on treaty positions and HMRC disclosures'
    ],
    'Flat fee, no surprises.',
    1000, 'one-off', null, false, false, 90),
  ('dormant', 'company',
    'Dormant company',
    'For companies with no trading activity in the period.',
    'For companies that are inactive and have no business activity in the period.',
    array[
      'Dormant annual accounts prepared and filed',
      'CT600 nil return to HMRC',
      'Companies House submission',
      'Flat fee, no surprises'
    ],
    null,
    150, 'one-off', null, false, false, 100),
  ('non_vat_reg', 'company',
    'Non-VAT registered company',
    'Full year-end accounts and corporation tax, done.',
    'For trading companies that are not VAT registered. Includes bookkeeping, year-end accounts, and corporation tax.',
    array[
      'Annual accounts prepared and filed at Companies House',
      'Corporation tax return (CT600) filed with HMRC',
      'Bookkeeping from your bank statements',
      'Flat fee, no surprises'
    ],
    null,
    700, 'one-off', null, false, false, 110),
  ('vat_reg', 'company',
    'VAT-registered company',
    'Year-end accounts, corporation tax, and ongoing VAT returns. For annual turnover under £200k.',
    'For VAT registered trading companies with annual turnover under £200k. Covers year-end accounts, corporation tax, and each VAT return in the engagement period.',
    array[
      'Everything in Non-VAT registered',
      'VAT return filing for every period',
      'Monthly, quarterly or annual VAT cycles supported',
      'Flat fee, no surprises'
    ],
    null,
    1000, 'one-off', null, false, false, 120),
  ('vat_plus_accounts_200k', 'company',
    'VAT Registered + Accounts (over £200k turnover)',
    'Larger-company engagement. We scope and price around your business.',
    'For VAT-registered companies with annual turnover over £200k. We quote per engagement after a short call.',
    array[
      'Full year-end accounts + corporation tax',
      'VAT return filing for every period',
      'Scoping call to confirm fit + bespoke flat fee'
    ],
    null,
    0, null, 'Bespoke', true, false, 130),
  ('vat_plus_accounts_bespoke', 'company',
    'VAT Registered + Accounts (bespoke)',
    'Bespoke engagement priced on a scoping call. Full accounts, CT, and every VAT return.',
    null,
    null,
    null,
    0, null, null, false, true, 140)
on conflict (id) do nothing;
