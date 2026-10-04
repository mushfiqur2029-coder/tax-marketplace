-- Limited-company Batch 4: accountant enters accounting period dates,
-- client uploads a second-stage document set for that period, then the
-- accountant assembles the client-approval screen (CT liability info +
-- payment reference + note).
--
-- Dormant companies skip the period and the second-stage docs entirely.
-- The approval cycle still runs for Dormant (no CT to pay on a nil
-- return — the approval card just says so).
--
-- Status machine stays shape-unchanged: for the limited-company path,
-- accountant moves in_review → client_approval directly via
-- prepareApprovalAction, skipping the intermediate 'prepared' step
-- (meaningless when there's no per-service action between upload and
-- client sign-off). Personal flow unchanged.

alter table public.cases
  add column if not exists period_start_date date,
  add column if not exists period_end_date date,
  add column if not exists payroll_registered boolean not null default false,
  add column if not exists period_docs_submitted_at timestamptz,
  -- Structured client-approval payload: CT liability pence, HMRC
  -- payment reference text, and an optional free-form note the
  -- accountant can add. Kept in one jsonb so Batch 5's VAT approval
  -- cycle has room to extend the shape without a column-per-field
  -- schema sprawl. Null until the accountant presses "Send for client
  -- approval".
  add column if not exists approval_payload jsonb;

-- No RLS changes needed. The existing cases read/update policies cover
-- the new columns (client reads own case, assigned accountant updates
-- own case, admin reads/updates all). approval_payload specifically
-- carries only accountant-authored content, no secrets, so the client
-- reading it is fine.
