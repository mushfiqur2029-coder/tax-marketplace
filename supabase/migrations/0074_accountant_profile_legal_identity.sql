-- 0074: Per-accountant legal identity on accountant_profiles.
--
-- The engagement letter template (src/lib/engagement/letter-template.ts)
-- hardcodes the Shann Accountancy / NAFH Accountants pair as the
-- "Accountant (legal name)" + "Accountant trading name" rows for every
-- case. That's fine when there's one accountancy firm on the platform
-- but breaks the moment a second accountant with a different legal
-- entity signs up: the client sees a legal name that doesn't match
-- who's actually doing their work.
--
-- Fix: three nullable columns on accountant_profiles. The renderer
-- looks them up for the case's assigned accountant and falls back to
-- the existing hardcoded strings only when all three are NULL (so
-- legacy accountants who haven't filled them in still produce a
-- valid letter rather than printing "null"). Admin UI to edit these
-- is a follow-up; for the current onboarding of Shann/NAFH the
-- hardcoded fallback does the right thing.
--
-- Column shapes mirror the existing company_name / contact_number
-- shapes on accountant_profiles: plain text, no CHECK constraints.
-- company_number uses the same format the letter already prints
-- (free text, admin enters it alongside legal name).

alter table public.accountant_profiles
  add column if not exists legal_name text,
  add column if not exists trading_name text,
  add column if not exists legal_company_number text;
