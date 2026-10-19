-- 0093: Phase 6 Slice 1, collapse the 24-slot PCH checklist down to 3.
--
-- Phase 6 shifts the client intake from a "produce 24 documents" model
-- to a bookkeeping-first flow: upload Photo ID + a bank statement for
-- each tax period, let the AI read everything, then clarify in chat.
-- The signed approval still exists at the end.
--
-- Scope decision (operator-confirmed): no live PCH automated cases, so
-- we can simply flip an `active` flag on the slot catalogue and the
-- client workspace renders only the three active slots. Historical
-- rows are preserved so any admin view of an old test case still has
-- labels for pch_doc_status rows it may hold.
--
-- Active slots after this migration:
--   PCH-24 Photo ID (passport or driving licence)      sort 10
--   PCH-14 Bank statements (covers every account)      sort 20
--   PCH-23 Signed approval of accounts                 sort 30
--
-- PCH-24 moves from "skip" extraction mode to a full AI vision pass
-- (Slice 1 server-side change in ai-extract.ts); the extracted fields
-- (name, DOB, address, postcode) are written back to pch_cases head
-- columns via the apply map in extraction-apply.ts.
--
-- PCH-14 copy expands to make clear the client should upload one bank
-- statement per account (and per prior period if any were added).

alter table public.pch_doc_slots
  add column if not exists active boolean not null default false;

-- Mark the three Phase 6 slots as active and refresh their copy.
update public.pch_doc_slots
  set active = true,
      section = 'Identity',
      display_name = 'Photo ID (passport or driving licence)',
      why_we_need_it = 'We read your name, date of birth, and address off this. Passport, or both sides of a UK driving licence.',
      accepted_formats = 'PDF, JPG, PNG, HEIC',
      required_rule = 'Required',
      sort_order = 10
  where code = 'PCH-24';

update public.pch_doc_slots
  set active = true,
      section = 'Bank',
      display_name = 'Bank statements (every account that received income or paid expenses)',
      why_we_need_it = 'We read every transaction and categorise it for you. Upload one statement per account for the whole tax period, plus one per prior period you added.',
      accepted_formats = 'PDF, CSV, XLSX',
      required_rule = 'Required',
      sort_order = 20
  where code = 'PCH-14';

update public.pch_doc_slots
  set active = true,
      section = 'Sign-off',
      display_name = 'Signed approval of accounts',
      why_we_need_it = 'Your signature confirming the accounts your accountant prepared.',
      accepted_formats = 'Signed PDF or e-sign',
      required_rule = 'Required',
      sort_order = 30
  where code = 'PCH-23';

-- Every other slot stays inactive; the client workspace query filters
-- on active = true, so these rows become invisible to new cases without
-- being destructively removed.
update public.pch_doc_slots
  set active = false
  where code not in ('PCH-14', 'PCH-23', 'PCH-24');
