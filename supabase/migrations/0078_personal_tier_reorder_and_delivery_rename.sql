-- Reorder the nine personal service tiers so the four highest-volume
-- segments sit first, and rename the gig_worker tier to drop the
-- "gig workers" phrasing in favour of "Delivery Drivers".
--
-- New personal display order (ascending):
--    uber_driver              10  (unchanged)
--    gig_worker               20  (was 60; now second)
--    landlord_small           30  (was 40)
--    sole_trader              40  (was 30)
--    cis_subcontractor        50  (was 20)
--    non_resident_landlord    60  (was 50)
--    freelancer_consultant    70  (unchanged)
--    landlord_multi           80  (unchanged)
--    complex_international    90  (unchanged)
--
-- Company tiers (dormant, non_vat_reg, vat_reg, vat_plus_accounts_*)
-- are not touched by this migration.
--
-- The tier id `gig_worker` stays. It is a Postgres case_tier enum
-- value, referenced in historical cases rows and in five earlier
-- migrations' fee case/when tables. Renaming the id would require
-- backfilling live case data and Stripe metadata, which is outside
-- the scope of a copy change. Only the display fields change here.
--
-- Idempotent: each UPDATE is keyed by id and simply resets the two
-- fields we care about, so re-running is harmless.

update public.service_catalog set display_order = 10 where id = 'uber_driver';
update public.service_catalog set display_order = 20 where id = 'gig_worker';
update public.service_catalog set display_order = 30 where id = 'landlord_small';
update public.service_catalog set display_order = 40 where id = 'sole_trader';
update public.service_catalog set display_order = 50 where id = 'cis_subcontractor';
update public.service_catalog set display_order = 60 where id = 'non_resident_landlord';
update public.service_catalog set display_order = 70 where id = 'freelancer_consultant';
update public.service_catalog set display_order = 80 where id = 'landlord_multi';
update public.service_catalog set display_order = 90 where id = 'complex_international';

update public.service_catalog
  set title = 'Delivery Drivers',
      tagline = 'Deliveroo, Uber Eats, Amazon Flex, Just Eat. Delivery income done right.'
  where id = 'gig_worker';
