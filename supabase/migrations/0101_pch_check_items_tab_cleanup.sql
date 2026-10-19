-- Phase 7 Slice 7.4: strip stale "tab N" references from the 33-point
-- accountant review checklist copy.
--
-- The original seed (migration 0080) referenced external Excel-template
-- tab numbers that are not screens in the app. Phase 5 + Phase 6
-- automated those surfaces (bank statement upload, VEHICLE_CA
-- interview, SA302 reconciliation panel) so the tab references now
-- confuse rather than guide. Idempotent plain UPDATEs so this is safe
-- to re-run.

update public.pch_check_items
  set description = 'Ratios inside the normal range or explained'
  where item_number = 18;

update public.pch_check_items
  set description = 'TfL-licensed Uber client: VAT registration test (turnover vs £90k threshold) run and recorded'
  where item_number = 22;

update public.pch_check_items
  set description = 'Every estimate has a method code (bank statement, receipt, estimate E2 etc.), a written working, and client confirmation'
  where item_number = 27;

update public.pch_check_items
  set description = 'SA103S / SA100 boxes copied into the filing software; SA302 reconciliation agrees with the engine'
  where item_number = 29;
