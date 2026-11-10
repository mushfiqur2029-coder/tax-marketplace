-- Two concurrency fixes from the 2026-11-09 final audit of the bulk-
-- intake pipeline, both made real (not just theoretical) by the
-- same-day change that makes bulk-document-upload.tsx fire every
-- file in a multi-file drop via Promise.all instead of one at a
-- time: several uploadBulkIntakeDocumentAction calls, and several
-- runBulkIntakeExtractionJob background jobs, can now genuinely
-- overlap in time for the SAME case.
--
-- Both are implemented as plain functions (not triggers): an advisory
-- transaction lock plus the read-then-write step are done inside one
-- function call, which is one round trip and one implicit
-- transaction from the caller's point of view, closing the race
-- without needing a lock to be held open across separate requests
-- (which a connection-pooled REST client like PostgREST cannot do
-- anyway).

-- 1. Per-case upload cap (MAX_UPLOADS_PER_CASE = 25, enforced in
--    bulk-intake-actions.ts with a SELECT count(*) ... ; INSERT -
--    check-then-insert, not atomic). With uploads now firing
--    concurrently, N concurrent requests for a case already at/near
--    the cap can all read the same pre-insert count, all pass the
--    check, and all insert - landing the case up to (N-1) over the
--    intended limit. pch_claim_intake_upload() locks per case_id,
--    re-counts, and inserts in one call, so uploadBulkIntakeDocumentAction
--    calls this instead of doing its own count-check + insert.
create or replace function public.pch_claim_intake_upload(
  p_case_id uuid,
  p_storage_path text,
  p_file_name text
)
returns public.pch_intake_uploads
language plpgsql
as $$
declare
  current_count integer;
  v_row public.pch_intake_uploads;
begin
  perform pg_advisory_xact_lock(hashtext(p_case_id::text || ':pch_intake_uploads'));
  select count(*) into current_count
  from public.pch_intake_uploads
  where case_id = p_case_id;
  if current_count >= 25 then
    raise exception 'Upload limit reached for this case, message your accountant if you need to add more.';
  end if;
  insert into public.pch_intake_uploads (case_id, storage_path, file_name, status)
  values (p_case_id, p_storage_path, p_file_name, 'pending')
  returning * into v_row;
  return v_row;
end;
$$;

-- 2. sort_order on pch_income_lines / pch_expense_lines was assigned
--    by bulk-intake-trigger.ts as a plain "read max(sort_order) for
--    this case, add 1, insert" with no lock backing it (unlike the
--    fixed-slot top-up path, which already has a partial unique
--    index from migration 0125 for exactly this reason). Before
--    uploads could run concurrently for the same case, two of these
--    reads racing was rare enough not to matter; now several
--    background jobs for one case can start within milliseconds of
--    each other, two inserts can read the same max and both write
--    the same sort_order, leaving a duplicate tie whose relative
--    order in the review list and any SA103S export is then
--    arbitrary. Doesn't affect amounts, only ordering, but it's a
--    real, now-more-likely bug.
--
--    Four call sites in bulk-intake-trigger.ts get their own locked
--    insert function (rather than one generic jsonb-based function):
--    the two "fixed-slot row doesn't exist yet, create it" branches
--    inside topUpIncomeSlot/topUpExpenseSlot, and the two "no
--    matching slot, insert a visible extra row" branches. The
--    existing partial unique index + 23505 retry loop in
--    bulk-intake-trigger.ts still handles the separate race on the
--    SAME fixed-slot label; this closes the sort_order race that sits
--    alongside it.
create or replace function public.pch_insert_income_topup_row(
  p_case_id uuid,
  p_source text,
  p_gross_takings_pence integer,
  p_upload_id uuid,
  p_confidence text,
  p_note text
)
returns public.pch_income_lines
language plpgsql
as $$
declare
  v_next integer;
  v_row public.pch_income_lines;
begin
  perform pg_advisory_xact_lock(hashtext(p_case_id::text || ':pch_income_lines'));
  select coalesce(max(sort_order), -1) + 1 into v_next
  from public.pch_income_lines where case_id = p_case_id;
  insert into public.pch_income_lines (
    case_id, source, gross_takings_pence, platform_fee_pence,
    on_trip_miles, dead_miles, line_type, sort_order,
    auto_extracted, client_reviewed, source_upload_id,
    extraction_confidence, extraction_note
  ) values (
    p_case_id, p_source, p_gross_takings_pence, 0,
    0, 0, 'Fares', v_next,
    true, false, p_upload_id,
    p_confidence, p_note
  )
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.pch_insert_income_unmatched_row(
  p_case_id uuid,
  p_source text,
  p_gross_takings_pence integer,
  p_upload_id uuid,
  p_confidence text,
  p_note text,
  p_likely_personal boolean
)
returns public.pch_income_lines
language plpgsql
as $$
declare
  v_next integer;
  v_row public.pch_income_lines;
begin
  perform pg_advisory_xact_lock(hashtext(p_case_id::text || ':pch_income_lines'));
  select coalesce(max(sort_order), -1) + 1 into v_next
  from public.pch_income_lines where case_id = p_case_id;
  insert into public.pch_income_lines (
    case_id, source, gross_takings_pence, platform_fee_pence,
    on_trip_miles, dead_miles, line_type, sort_order,
    auto_extracted, client_reviewed, source_upload_id,
    extraction_confidence, extraction_note, likely_personal
  ) values (
    p_case_id, p_source, p_gross_takings_pence, 0,
    0, 0, 'Other', v_next,
    true, false, p_upload_id,
    p_confidence, p_note, p_likely_personal
  )
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.pch_insert_expense_topup_row(
  p_case_id uuid,
  p_label text,
  p_amount_paid_pence integer,
  p_category text,
  p_sa103s_box text,
  p_car_cost text,
  p_upload_id uuid,
  p_confidence text,
  p_note text
)
returns public.pch_expense_lines
language plpgsql
as $$
declare
  v_next integer;
  v_row public.pch_expense_lines;
begin
  perform pg_advisory_xact_lock(hashtext(p_case_id::text || ':pch_expense_lines'));
  select coalesce(max(sort_order), -1) + 1 into v_next
  from public.pch_expense_lines where case_id = p_case_id;
  insert into public.pch_expense_lines (
    case_id, label, amount_paid_pence, category, sa103s_box, car_cost,
    sort_order, auto_extracted, client_reviewed, source_upload_id,
    extraction_confidence, extraction_note
  ) values (
    p_case_id, p_label, p_amount_paid_pence, p_category, p_sa103s_box, p_car_cost,
    v_next, true, false, p_upload_id,
    p_confidence, p_note
  )
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.pch_insert_expense_unmatched_row(
  p_case_id uuid,
  p_label text,
  p_amount_paid_pence integer,
  p_category text,
  p_sa103s_box text,
  p_car_cost text,
  p_upload_id uuid,
  p_confidence text,
  p_note text,
  p_likely_personal boolean
)
returns public.pch_expense_lines
language plpgsql
as $$
declare
  v_next integer;
  v_row public.pch_expense_lines;
begin
  perform pg_advisory_xact_lock(hashtext(p_case_id::text || ':pch_expense_lines'));
  select coalesce(max(sort_order), -1) + 1 into v_next
  from public.pch_expense_lines where case_id = p_case_id;
  insert into public.pch_expense_lines (
    case_id, label, amount_paid_pence, category, sa103s_box, car_cost,
    sort_order, auto_extracted, client_reviewed, source_upload_id,
    extraction_confidence, extraction_note, likely_personal
  ) values (
    p_case_id, p_label, p_amount_paid_pence, p_category, p_sa103s_box, p_car_cost,
    v_next, true, false, p_upload_id,
    p_confidence, p_note, p_likely_personal
  )
  returning * into v_row;
  return v_row;
end;
$$;
