-- 0077: optional sale price on service_catalog rows.
--
-- Marketing pages (homepage pricing, service pages) show the catalog's
-- price_gbp. When admin wants to run a "was £X now £Y" promotion we
-- need somewhere to park the discounted price without clobbering the
-- regular one, restoring from a struck price is a code change today.
--
-- Shape:
--   • sale_price_gbp integer null
--   • Nullable (default behavior = no sale running).
--   • Check constraint: when set, must be > 0 AND strictly less than
--     price_gbp. "Sale same as regular" means null, not sale=regular.
--     price_gbp=0 tiers (the enquiry-only "Bespoke" row) can never
--     carry a sale since the constraint fails: sale cannot be < 0.
--
-- Not touching the existing original_gbp / save_gbp columns on this
-- table. Those are legacy fields that aren't wired into the current
-- marketing UI; keeping them untouched for forward-compat in case
-- another surface still reads them.
--
-- The /api/public/pricing endpoint will surface sale_price_gbp as
-- salePriceGbp (camelCase) in the JSON response. The static marketing
-- site renders "was £X now £Y" styling when it's non-null.

alter table public.service_catalog
  add column if not exists sale_price_gbp integer;

-- Drop first so re-runs against a previously-constrained schema don't
-- fail on "constraint already exists" when the body changed.
alter table public.service_catalog
  drop constraint if exists service_catalog_sale_price_valid;

alter table public.service_catalog
  add constraint service_catalog_sale_price_valid
  check (
    sale_price_gbp is null
    or (sale_price_gbp > 0 and sale_price_gbp < price_gbp)
  );
