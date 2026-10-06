-- Immutable price snapshot backfill.
--
-- The product rule: admin price edits never retroactively change
-- already-created cases. Going forward, createCaseAction + the bespoke
-- action snapshot cases.custom_fee_pence at insert time. This migration
-- backfills every historic case that still has NULL custom_fee_pence
-- using the CURRENT service_catalog price for its tier — which equals
-- the quoted price those cases were created under, since the catalogue
-- hasn't been edited yet at the time this migration runs.
--
-- Idempotent: only touches rows where custom_fee_pence IS NULL.

-- cases.tier is a Postgres enum (case_tier); service_catalog.id is
-- text. Cast the enum to text so the join compares like-with-like.
update public.cases c
set custom_fee_pence = sc.price_gbp * 100
from public.service_catalog sc
where c.custom_fee_pence is null
  and c.tier::text = sc.id
  and sc.price_gbp > 0;
