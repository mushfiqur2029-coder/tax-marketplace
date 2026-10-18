-- 0086: V5C logbook (PCH-05) is now optional, not required by default.
--
-- Clients are uncomfortable uploading the V5C by default because it
-- contains sensitive registered-keeper detail. The accountant can
-- still request it per case where it's genuinely needed (unusual CO2
-- figures, FYA eligibility, change-of-keeper disputes), but we don't
-- make it a blanket ask.
--
-- The ai-extract.ts registry also flips PCH-05 to "skip" mode in the
-- same change so the AI never pre-fills from a V5C unless a different
-- slot delivers that data.

update public.pch_doc_slots
  set required_rule = 'Optional, accountant may request'
  where code = 'PCH-05';
