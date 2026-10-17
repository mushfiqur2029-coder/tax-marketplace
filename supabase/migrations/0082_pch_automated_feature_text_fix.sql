-- Follow-up to 0080 and 0081: three user-visible dash occurrences from
-- the seed migrations violate the repo-wide no-em-dash and no-en-dash
-- rule. Rewrite each with a comma-pause.
--   * service_catalog feature line (em dash)
--   * pch_doc_slots PCH-09 display name (en dash)
--   * pch_doc_slots PCH-14 display name (en dash)
-- Harmless if the seeds were not yet applied (no row to update).

update public.service_catalog
set features = array[
  'Guided questionnaire, tabs follow HMRC''s own SA103S boxes',
  'Instant draft P&L and tax computation from your figures',
  'Accountant review before anything is filed',
  '24-item document checklist built in'
]
where id = 'uber_phv_automated';

update public.pch_doc_slots
set display_name = 'Fuel / charging, receipts or highlighted bank lines'
where code = 'PCH-09';

update public.pch_doc_slots
set display_name = 'Bank statements, account receiving platform payouts'
where code = 'PCH-14';
