-- 0105: Phase 7 Slice 7.6c, record the date a vehicle was sold or
-- part-exchanged.
--
-- pch_vehicle already carries .disposed (boolean) and
-- .disposal_proceeds_pence (int) from migration 0080. compute.ts uses
-- both to apply a balancing allowance or balancing charge when a car
-- leaves the capital-allowances pool. The accountant also wants the
-- disposal date for the audit trail (balancing-allowance / charge
-- schedules on HMRC filings reference it), so Slice 7.6c captures it
-- in the new VEHICLE_CA_EXT interview.
--
-- Nullable: the overwhelming majority of cases will have no disposal
-- in the tax year, so disposal_date stays null and the pch_vehicle
-- row only populates .disposed = false (default).

alter table public.pch_vehicle
  add column if not exists disposal_date date;
