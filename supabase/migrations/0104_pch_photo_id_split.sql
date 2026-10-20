-- 0104: Phase 8 Slice 8.3, split Photo ID into passport vs licence.
--
-- Phase 6 shipped PCH-24 as a single-upload slot with a generic vision
-- prompt. Live screenshots caught two failure modes:
--   1. Drivers uploading only the front of a UK driving licence, which
--      carries the address but no DOB; the AI dutifully reported DOB
--      missing but the client had no way to upload the back.
--   2. The vision prompt wasn't told whether it was looking at a
--      passport or a licence front/back, so it had to guess per image.
--
-- Fix: let the client declare up-front whether they have a passport or
-- a licence. Passport stays one upload. Licence becomes two labelled
-- slots (Front, Back). The AI is told which it's looking at.
--
-- Columns:
--   pch_cases.photo_id_kind
--     Top-level choice persisted on the case so the UI remembers it
--     across refreshes. Nullable until the client makes a choice.
--
--   case_documents.photo_id_side
--     Per-upload tag for licence Front / Back. Null for passport
--     uploads and every non-PCH-24 slot.
--
--   pch_doc_extractions.photo_id_side
--     Copied over from case_documents when the extraction is scheduled
--     so the review UI can label each extraction card without a join.

alter table public.pch_cases
  add column if not exists photo_id_kind text;

alter table public.pch_cases
  drop constraint if exists pch_cases_photo_id_kind_check;
alter table public.pch_cases
  add constraint pch_cases_photo_id_kind_check check (
    photo_id_kind is null or photo_id_kind in ('passport', 'licence')
  );

alter table public.case_documents
  add column if not exists photo_id_side text;

alter table public.case_documents
  drop constraint if exists case_documents_photo_id_side_check;
alter table public.case_documents
  add constraint case_documents_photo_id_side_check check (
    photo_id_side is null or photo_id_side in ('front', 'back')
  );

alter table public.pch_doc_extractions
  add column if not exists photo_id_side text;

alter table public.pch_doc_extractions
  drop constraint if exists pch_doc_extractions_photo_id_side_check;
alter table public.pch_doc_extractions
  add constraint pch_doc_extractions_photo_id_side_check check (
    photo_id_side is null or photo_id_side in ('front', 'back')
  );
