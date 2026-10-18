-- 0084: Mailing address on accountant_profiles.
--
-- The accounts-pack export (PDF + Excel for PCH automated cases)
-- prints a "Prepared By:" firm block with name + address. The firm
-- name maps to the existing trading_name / company_name / legal_name
-- columns; the address did not exist yet. One nullable text column,
-- multi-line (admin enters "123 Street Rd\nTown\nPostcode"). Export
-- falls back to the firm name alone when address is NULL so a
-- half-filled profile still produces a valid pack.
--
-- Not required for anything else right now; admin UI to edit this is
-- a follow-up.

alter table public.accountant_profiles
  add column if not exists address text;
