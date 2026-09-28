-- Multi-attachment support: one message row can carry N attachments so
-- sending N files produces ONE message row (and ONE notification via the
-- existing per-row notify_new_message trigger).
--
-- Design: a jsonb array column on messages, not a separate table.
-- Reasoning:
--   • Attachments are only ever loaded WITH their parent message. There is
--     no query across cases like "all attachments of type X"; a join would
--     cost extra without benefit.
--   • Realtime pushes the full row payload, so the recipient's chat panel
--     renders N attachments with zero extra queries.
--   • Migration is a single UPDATE, backfilling old singular columns into
--     the array.
--   • No FK integrity is being lost — nothing else in the schema references
--     an individual attachment.
--
-- The old singular columns (attachment_path / attachment_name /
-- attachment_type) stay in the schema for now for zero-risk rollback, but
-- new inserts write only to `attachments` and the old columns are nulled
-- for existing rows once their data is copied into the array.

alter table public.messages
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- Backfill existing single-attachment rows into the array. Only rows that
-- have a real attachment (path set) and haven't already been migrated
-- (attachments is still the default empty array) get touched.
update public.messages
   set attachments = jsonb_build_array(
         jsonb_build_object(
           'path', attachment_path,
           'name', coalesce(attachment_name, split_part(attachment_path, '/', -1)),
           'type', coalesce(attachment_type, '')
         )
       ),
       -- Null out the singular fields so reads go through the array cleanly
       -- and there's no ambiguity about which column is authoritative.
       attachment_path = null,
       attachment_name = null,
       attachment_type = null
 where attachment_path is not null
   and (attachments is null or attachments = '[]'::jsonb);

-- notify_new_message trigger is unchanged — it fires per row insert, so
-- one message row (with N attachments) still equals one notification.
