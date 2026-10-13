-- 0076: move the custom add-on price cap into addon_catalog so admin
-- can edit it without a code change.
--
-- Before: src/app/accountant/actions.ts (requestCustomAddonAction) had
-- a hardcoded `if (amountPence > 500_000) throw "...over £5,000..."`.
-- Every other price in the app is admin-editable via addon_catalog or
-- service_catalog; the custom-cap was the only hardcoded exception.
--
-- Shape: a sentinel row in addon_catalog with the reserved key
-- `__custom_max__`. The `__` double-underscore prefix marks this row
-- as "config, not a pickable preset" so neither the accountant preset
-- picker (filters active = true) nor the admin addon list (filters
-- `__`-prefixed in TS) renders it alongside real add-ons.
--
-- Stays active=false specifically to keep the preset picker safe:
-- the picker already filters by active=true, so an admin accidentally
-- flipping this row in the UI is the only path to leak the sentinel
-- into the picker. The admin page suppresses the active toggle for the
-- sentinel; backend validation is defense-in-depth, not a UI contract.
--
-- The `on conflict (key) do nothing` makes this idempotent so re-runs
-- against a seeded DB keep whatever amount_pence admin set.

insert into public.addon_catalog (key, name, description, amount_pence, active) values
  ('__custom_max__',
   'Custom add-on cap',
   'Server-side maximum for a single custom add-on amount. Accountant-side requestCustomAddonAction rejects anything above this. Edit from the Admin → Add-on catalog page.',
   500000,
   false)
on conflict (key) do nothing;
