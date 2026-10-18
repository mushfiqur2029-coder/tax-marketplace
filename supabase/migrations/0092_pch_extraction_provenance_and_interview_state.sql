-- 0092: Provenance on pch_doc_extractions + new slot status for
-- "client walked through an AI interview but one or more fields came
-- back missing and the accountant needs to resolve them".
--
-- Driven by two bundled slices:
--
--   Slice 2 (provenance plumbing): pch_doc_extractions picks up a
--   `source` column so the review UI can show the client "Extracted
--   from your document" vs "Confirmed through AI conversation". The
--   fields jsonb shape is unchanged; the extraction is still never
--   auto-applied; raw_json still stores the audit trail (for interview
--   rows this is the transcript).
--
--   Slice 3 (PCH-01 AI interview): when the AI interview finishes
--   with at least one field marked `missing` (the client said "I
--   don't know" and the AI is not allowed to guess), the slot's
--   pch_doc_status row flips to the new 'Awaiting accountant' state
--   so the accountant can see what needs chasing up proactively.
--   Same philosophy as the prior-year anomaly flagging shipped in
--   Phase 4: surface it, don't make the accountant hunt.
--
-- No live PCH cases on the pre-slice state (operator confirmed), so
-- the backfill is simple: existing extraction rows become 'document'
-- (the column default).

-- -- pch_doc_extractions ---------------------------------------------
alter table public.pch_doc_extractions
  alter column document_id drop not null;

alter table public.pch_doc_extractions
  add column if not exists source text not null default 'document'
    check (source in ('document', 'ai_interview'));

-- Any existing row (there shouldn't be live ones, but be defensive)
-- carries `source = 'document'` via the column default.

-- Row-level integrity: an AI-interview row must NOT reference a
-- case_documents row (there isn't one); a document row MUST have a
-- document_id. Enforce via a check constraint, cheaper + simpler than
-- a trigger.
alter table public.pch_doc_extractions
  drop constraint if exists pch_doc_extractions_source_document_shape;
alter table public.pch_doc_extractions
  add constraint pch_doc_extractions_source_document_shape check (
    (source = 'document'      and document_id is not null)
    or
    (source = 'ai_interview'  and document_id is null)
  );

-- -- pch_doc_status --------------------------------------------------
-- Extend the status check to include the new 'Awaiting accountant'
-- value. The existing check constraint is anonymous; we drop by name
-- using the DO block to look it up, since pg's default naming is
-- "<table>_<column>_check" for a column CHECK.
alter table public.pch_doc_status
  drop constraint if exists pch_doc_status_status_check;
alter table public.pch_doc_status
  add constraint pch_doc_status_status_check check (
    status in ('Uploaded', 'Not applicable', 'Awaiting', 'Awaiting accountant')
  );
