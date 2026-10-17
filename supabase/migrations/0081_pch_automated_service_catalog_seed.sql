-- Seed the service_catalog row for the new uber_phv_automated tier
-- added in migration 0080. Shown to clients in the /client/new picker.
--
-- Positioned right after uber_driver (which stays as the manual-upload
-- version for drivers who prefer the current flow). display_order 15
-- slots between uber_driver (10) and gig_worker (20) without renumbering.
--
-- Price starts at the same point as uber_driver (£199) for parity.
-- Admin can bump via the service_catalog admin page without a redeploy.

insert into public.service_catalog
  (id, "group", title, tagline, description, features, footer_line,
   price_gbp, price_gbp_subtitle, requires_enquiry, admin_create_only,
   display_order)
values
  ('uber_phv_automated', 'personal',
    'Uber / PHV automated',
    'Automated self-assessment for Uber, Bolt and other private-hire drivers.',
    null,
    array[
      'Guided questionnaire, tabs follow HMRC''s own SA103S boxes',
      'Instant draft P&L and tax computation from your figures',
      'Accountant review before anything is filed',
      '24-item document checklist built in'
    ],
    'Flat fee, no surprises.',
    199, 'one-off', false, false, 15)
on conflict (id) do nothing;
