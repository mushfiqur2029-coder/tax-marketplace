-- Concurrency guard for the Phase B bulk-intake extractor. When a
-- client drops 2+ documents at once, the per-upload background jobs
-- (uploadBulkIntakeDocumentAction + runBulkIntakeExtractionJob) run
-- concurrently and can race on the SAME fixed-slot top-up: both read
-- "no row for Fuel", both insert, duplicate rows result. Even once a
-- row exists, two jobs reading the same old amount and writing back
-- old+their_amount loses one addition under classic lost-update.
--
-- Partial unique indexes close the duplicate-insert race at the DB
-- level: the second concurrent INSERT for the same (case_id, slot
-- label) fails with 23505 and the extractor retries, picking up the
-- row the first insert created. The read-update-write race is closed
-- separately in bulk-intake-trigger.ts via optimistic locking (an
-- .eq() on the old pence value in the UPDATE's WHERE clause), with
-- retries on zero-row-affected.
--
-- Scoped WHERE to the fixed-slot labels (same list as
-- INCOME_FIXED_SLOTS / EXPENSE_FIXED_SLOTS in intake-slots.ts) so
-- unmatched extra rows and freeform accountant-added rows retain
-- their current behaviour of allowing multiple rows per case with
-- the same label text.

create unique index if not exists pch_income_lines_case_fixed_slot_uq
  on public.pch_income_lines (case_id, source)
  where source in ('Uber', 'Bolt', 'Free Now', 'Cash receipt', 'Others income');

create unique index if not exists pch_expense_lines_case_fixed_slot_uq
  on public.pch_expense_lines (case_id, label)
  where label in (
    'Fuel', 'Insurance', 'Cleaning', 'Repairs & Maintenance',
    'Licence Fees', 'Pension', 'MOT', 'Road Tax', 'Mobile',
    'Accountancy Fees', 'Parking, Congestion & ULEZ',
    'Cash expense', 'Other expense'
  );
