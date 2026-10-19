-- Phase 7 Slice 7.2: file attachments on case messages.
--
-- jsonb column keeps the write cheap (no join on render) and avoids
-- another table + FK + RLS set for low-write message attachments.
-- Each entry: { path, name, mime, size_bytes }.
--   path         relative storage path under the case-documents bucket:
--                "{case_id}/messages/{msg_id}/{sanitised_filename}"
--   name         original filename for display
--   mime         best-known content type for icon + inline preview
--   size_bytes   displayed to the receiver, enforced client + server side
--
-- Default null, nullable. Legacy messages without attachments stay as
-- null; renderers treat null/empty array identically. Max attachments
-- per message is enforced at the application layer (5), not the DB.

alter table public.case_messages
  add column if not exists attachments jsonb;
