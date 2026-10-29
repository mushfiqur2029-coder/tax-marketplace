-- Phase A of the PCH intake redesign: the client picks between
-- typing in their income/expenses by hand (same fixed-slot grid
-- that's been there since Phase J) and uploading bank statements /
-- receipts for AI extraction. The AI extraction pipeline itself is
-- Phase B; this column just stores the choice so Phase A can gate
-- which flow renders.
--
-- Column stays nullable only transiently, on cases created AFTER
-- this ships, until the client makes the pick. Every row that
-- already exists is backfilled to 'manual' so no in-flight return
-- suddenly starts seeing the choice screen - preserving today's
-- behaviour exactly for current clients.
--
-- Check constraint enforces the two valid values; the "forbid
-- auto_upload" Phase-A guard lives in setIntakeMethodAction (so
-- the UI's disabled card alone isn't the only line of defence),
-- not at the DB level, because once Phase B ships we want both
-- values live without a schema change.

alter table public.pch_cases
  add column if not exists intake_method text
    check (intake_method in ('manual', 'auto_upload'));

update public.pch_cases
  set intake_method = 'manual'
  where intake_method is null;

comment on column public.pch_cases.intake_method is
  'How the client chose to enter income/expenses for this case: manual (typed fixed-slot entry) or auto_upload (upload bank statements/receipts for AI extraction). Null only transiently before the client picks, on cases created after this column existed; all pre-existing cases are backfilled to manual.';
