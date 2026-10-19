-- Phase 7 Slice 7.1: multi-file upload support + new cash-receipts slot.
--
-- allow_multiple flag on pch_doc_slots lets the client workspace render
-- <input multiple> per slot and loop uploadPchDocumentAction per file.
-- Set true on PCH-14 (clients commonly have multiple bank accounts) and
-- the new PCH-25 cash receipts slot (clients bulk-upload receipts).
--
-- PCH-25 is an optional slot for cash receipts, handwritten expense
-- notes, and any other evidence the client has off-bank. Not required;
-- shows up right after bank statements under the Bank section.

alter table public.pch_doc_slots
  add column if not exists allow_multiple boolean not null default false;

insert into public.pch_doc_slots (
  code, section, display_name, why_we_need_it, accepted_formats,
  required_rule, sort_order, active, allow_multiple
) values (
  'PCH-25',
  'Bank',
  'Cash receipts and handwritten expense notes (optional)',
  'Anything paid in cash or not on your bank statement, phone photos work. Attach as many files as you like.',
  'PDF, JPG, PNG, HEIC',
  'Optional',
  25,
  true,
  true
)
on conflict (code) do update set
  section = excluded.section,
  display_name = excluded.display_name,
  why_we_need_it = excluded.why_we_need_it,
  accepted_formats = excluded.accepted_formats,
  required_rule = excluded.required_rule,
  sort_order = excluded.sort_order,
  active = excluded.active,
  allow_multiple = excluded.allow_multiple;

-- PCH-14 now accepts photo-of-paper statements via Claude vision, so
-- advertise JPG/PNG/WebP in the display string alongside the existing
-- PDF/CSV/XLSX. Enforcement is handled in bank-parse.ts (vision call)
-- and uploadPchDocumentAction (per-mimetype guard + HEIC rejection).
update public.pch_doc_slots
  set allow_multiple = true,
      accepted_formats = 'PDF, CSV, XLSX, JPG, PNG, WebP'
  where code = 'PCH-14';
