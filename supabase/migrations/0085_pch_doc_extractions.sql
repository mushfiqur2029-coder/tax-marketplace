-- 0085: AI document extraction storage for PCH automated cases.
--
-- One row per (case, document) extraction attempt. The AI reads the
-- uploaded doc, returns structured values + a confidence rating per
-- field, and this row stores both the raw model output (for audit)
-- and the per-field review state (accepted / edited / rejected).
--
-- NEVER AUTO-APPLIED. The client reviews each field; only
-- field_states entries with status 'accepted' flow into the intake
-- tables, and only via explicit server actions, not a trigger.
--
-- Schema:
--   id              Row id, matches the uploaded case_document.id
--                   so UI can join (one extraction per upload).
--   case_id         FK, cascade on case delete.
--   slot_code       PCH-01..PCH-24.
--   document_id     FK to case_documents (one extraction per upload).
--   model           Model name (claude-sonnet-4-6 etc.) for audit.
--   status          'pending' | 'done' | 'error' | 'skipped'.
--   extracted_at    When the AI call completed.
--   overall_confidence  'high' | 'medium' | 'low' | 'missing'.
--   document_type   Model's one-line description of what it read.
--   fields          Jsonb map of {fieldKey: {value, confidence, note}}.
--   field_states    Jsonb map of {fieldKey: {status, overrideValue, actedAt, actedBy}}
--                   where status in 'proposed' | 'accepted' | 'edited' | 'rejected'.
--                   Default per-field status = 'proposed'. Client UI
--                   mutates this via server actions.
--   raw_json        Full model response, for audit.
--   error_message   Populated when status = 'error'.
--   usage           Token usage + cost, for admin cost tracking.
--
-- RLS: enabled; client can read + mutate field_states on their own
-- cases, accountant can read on cases they own, admin unrestricted
-- via service_role.

create table if not exists public.pch_doc_extractions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  slot_code text not null references public.pch_doc_slots(code),
  document_id uuid not null references public.case_documents(id) on delete cascade,
  model text,
  status text not null check (status in ('pending', 'done', 'error', 'skipped')) default 'pending',
  extracted_at timestamptz,
  overall_confidence text check (overall_confidence in ('high', 'medium', 'low', 'missing')),
  document_type text,
  fields jsonb,
  field_states jsonb not null default '{}'::jsonb,
  raw_json jsonb,
  error_message text,
  usage jsonb,
  created_at timestamptz not null default now()
);

create index if not exists pch_doc_extractions_case_idx
  on public.pch_doc_extractions (case_id);
create index if not exists pch_doc_extractions_document_idx
  on public.pch_doc_extractions (document_id);

alter table public.pch_doc_extractions enable row level security;

-- Client: read + update field_states on their own cases. Insert happens
-- server-side via the upload action (admin client), not from the client.
create policy pch_doc_extractions_client_select on public.pch_doc_extractions
  for select using (
    exists (
      select 1 from public.cases c
      where c.id = pch_doc_extractions.case_id
      and c.client_id = auth.uid()
    )
  );
create policy pch_doc_extractions_client_update on public.pch_doc_extractions
  for update using (
    exists (
      select 1 from public.cases c
      where c.id = pch_doc_extractions.case_id
      and c.client_id = auth.uid()
    )
  );

-- Accountant: read on cases they own.
create policy pch_doc_extractions_accountant_select on public.pch_doc_extractions
  for select using (
    exists (
      select 1 from public.cases c
      where c.id = pch_doc_extractions.case_id
      and c.accountant_id = auth.uid()
    )
  );

-- Realtime so the client UI reflects extraction progress without a reload.
alter publication supabase_realtime add table public.pch_doc_extractions;
