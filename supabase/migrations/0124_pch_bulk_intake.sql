-- Phase B of the PCH intake redesign (migration 0123's intake_method
-- selector landed Phase A). The auto_upload path: client drops bank
-- statements / receipts / invoices, Claude Sonnet reads and
-- categorises each distinct line into the same pch_income_lines /
-- pch_expense_lines tables the manual grid already writes to, with a
-- "needs review" flag so the client can double-check anything the
-- model wasn't sure about before the case moves to the accountant.
--
-- Deliberately NOT a separate "extracted_items" shadow table: keeping
-- extracted lines in the same two intake tables means every reader
-- downstream (PlSummaryTable, PCH Accounts PDF, tax engine
-- hydrateInputsFromDb) stays unchanged. The two columns that drive
-- the review UI (auto_extracted + client_reviewed) are additive and
-- default to the "hand-typed" shape, so a case using intake_method=
-- 'manual' sees no behavioural change.

create table if not exists public.pch_intake_uploads (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'error')),
  items_count integer,
  error_message text,
  uploaded_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists pch_intake_uploads_case_id_idx
  on public.pch_intake_uploads (case_id, uploaded_at desc);

comment on table public.pch_intake_uploads is
  'Source documents the client dropped for AI auto-read/categorize intake (PCH Option 1). One row per uploaded file; status tracks the background extraction job. items_count is how many income/expense lines that document produced, for the client-facing summary.';

alter table public.pch_income_lines
  add column if not exists auto_extracted boolean not null default false,
  add column if not exists source_upload_id uuid references public.pch_intake_uploads(id),
  add column if not exists extraction_confidence text
    check (extraction_confidence in ('high', 'medium', 'low')),
  add column if not exists client_reviewed boolean not null default false,
  add column if not exists extraction_note text;

alter table public.pch_expense_lines
  add column if not exists auto_extracted boolean not null default false,
  add column if not exists source_upload_id uuid references public.pch_intake_uploads(id),
  add column if not exists extraction_confidence text
    check (extraction_confidence in ('high', 'medium', 'low')),
  add column if not exists client_reviewed boolean not null default false,
  add column if not exists extraction_note text;

comment on column public.pch_income_lines.auto_extracted is
  'true if this row (or a top-up to it) came from the AI bulk-intake pipeline rather than the client typing a figure directly.';
comment on column public.pch_income_lines.client_reviewed is
  'false until the client has looked at/edited an auto-extracted row. Drives the "check this" badge in the review UI.';
comment on column public.pch_income_lines.extraction_note is
  'Appended one line per bulk-extract top-up ("From your upload: Line 14, 12 Apr"). Kept short - the review UI shows the last few entries.';
comment on column public.pch_expense_lines.auto_extracted is
  'true if this row (or a top-up to it) came from the AI bulk-intake pipeline rather than the client typing a figure directly.';
comment on column public.pch_expense_lines.client_reviewed is
  'false until the client has looked at/edited an auto-extracted row. Drives the "check this" badge in the review UI.';
comment on column public.pch_expense_lines.extraction_note is
  'Appended one line per bulk-extract top-up ("From your upload: Line 14, 12 Apr"). Kept short - the review UI shows the last few entries.';

-- RLS: the client can SELECT their own pch_intake_uploads rows so the
-- "Reading..." / "Sorted into N lines" status chip in the upload-list
-- UI can live-sync via Supabase realtime (mirrors the SELECT policies
-- already in place on pch_income_lines / pch_expense_lines for the
-- same auth.uid() -> cases.client_id check). All writes to this
-- table (and the extraction fields on the two intake tables) go
-- through the admin client from server actions, so no insert/update
-- policy is needed here.
alter table public.pch_intake_uploads enable row level security;

drop policy if exists "pch_intake_uploads client read own case" on public.pch_intake_uploads;
create policy "pch_intake_uploads client read own case"
  on public.pch_intake_uploads
  for select
  to authenticated
  using (
    exists (
      select 1 from public.cases c
      where c.id = pch_intake_uploads.case_id
        and c.client_id = auth.uid()
    )
  );
