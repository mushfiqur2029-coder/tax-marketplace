-- 0091: Consolidate the two Uber-driver tiers down to one.
--
-- Before:
--   uber_driver          £199   display_order 10   (manual document-upload flow)
--   uber_phv_automated   £199   display_order 15   (new PCH automated engine)
--
-- After:
--   uber_phv_automated    £89   display_order 10   (automated engine, keeps the
--                                                   manual tile's title + bullets)
--
-- Scope decision confirmed by the operator: no existing live cases on
-- either tier so no backfill / migration of case rows is needed. The
-- Postgres `case_tier` enum still contains 'uber_driver' (dropping an
-- enum value is destructive and we don't need to); it just becomes
-- unselectable because the row is removed from service_catalog and
-- from PLAN_TIERS in plans.ts.
--
-- Idempotent: delete-if-exists and update-by-id, re-runnable.

delete from public.service_catalog where id = 'uber_driver';

update public.service_catalog
  set title = 'Uber / private-hire drivers',
      tagline = 'For Uber, Bolt, Addison Lee, and other private-hire drivers.',
      description = null,
      features = array[
        'Prepared and filed Self Assessment, signed off by a qualified accountant',
        'Mileage and allowable vehicle costs reviewed with you',
        'Platform fees, insurance, licensing claimed where allowable',
        'Accuracy guarantee + accountant message during filing'
      ],
      footer_line = 'Flat fee, no surprises.',
      price_gbp = 89,
      price_gbp_subtitle = 'one-off',
      display_order = 10
  where id = 'uber_phv_automated';
