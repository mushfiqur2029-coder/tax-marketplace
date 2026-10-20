-- Phase 8 Slice 8.1: expand pch_vehicle.status CHECK constraint from
-- the original 4-value set (Phase 6 Slice 4 era) to the 7-value set
-- the VEHICLE_CA interview actually asks the AI to return.
--
-- The mismatch has been live since Phase 6 Slice 4: the AI returns
-- 'No vehicle' / 'Hire purchase' / 'PCP' / 'Loan' / 'Rented', the DB
-- constraint rejects them with pch_vehicle_status_check. Reported
-- live after a client answered "no vehicle this year".
--
-- Clean break on the vocabulary (no live cases to migrate; the
-- test-identity cleanup emptied pch_vehicle).

alter table public.pch_vehicle
  drop constraint if exists pch_vehicle_status_check;

alter table public.pch_vehicle
  add constraint pch_vehicle_status_check check (
    status in (
      'Owned outright',
      'Hire purchase',
      'PCP',
      'Loan',
      'Leased',
      'Rented',
      'No vehicle'
    )
  );
