-- Phase F correction: a simple "did you use this for personal use too"
-- declaration. Yes/no flag; if yes, a plain money amount the client
-- types in (their own estimate of the private-use value/cost), no
-- percentage math. Not the same as business_pct_override, which stays
-- accountant-only tuning for the CA calc itself - this is a client-
-- supplied flag + figure for the accountant to factor in on review.
--
-- Lives on pch_vehicle because the vehicle is the main private-use
-- surface, but the UI question as asked covers "the vehicle or
-- anything you're claiming as an expense" - copy should read that
-- broadly even though the flag/amount is stored once, on the vehicle
-- row.
--
-- Applied live via apply_migration (name: pch_private_use_flag) and
-- verified against information_schema.columns before this file was
-- written; this file tracks it.

alter table public.pch_vehicle
  add column if not exists private_use_declared boolean,
  add column if not exists private_use_amount_pence integer;
