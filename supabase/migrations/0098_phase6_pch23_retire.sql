-- Phase 6: retire PCH-23 (manual sign-off upload) from active intake.
-- The Phase 6 Slice 7 final-pack flow replaces this slot: the
-- accountant generates the pack server-side and the client confirms
-- in-app, so there's nothing for the client to upload.
--
-- Soft-retire by flipping active = false. The slot row stays for
-- historical cases that may still reference it via pch_doc_uploads.
update public.pch_doc_slots
  set active = false
  where code = 'PCH-23';
