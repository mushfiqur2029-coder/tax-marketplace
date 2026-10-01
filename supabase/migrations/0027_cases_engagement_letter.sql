-- Engagement-letter columns on cases, for the Limited Company flow.
--
-- A client clicks "Sign" on the rendered letter, we snapshot their name
-- and phone off their profile at that moment, render a PDF server-side,
-- store the PDF and raw signature image in Supabase Storage, and stamp
-- the signed_at timestamp here. Payment is gated on engagement_signed_at
-- being present for limited_company_vat cases.
--
-- Snapshot principle (same as cases.urgent_fee_pence and
-- case_addons.description/amount_pence): the signed PDF is a legal
-- document, so later profile edits can't retroactively rewrite the
-- parties on it. The columns below are nullable because every other
-- segment ignores them.
--
-- Storage paths use the existing case-documents bucket under
-- signatures/{case_id}/ — see Batch 2 commit for the server action that
-- writes there. No new bucket needed.

alter table public.cases
  add column if not exists engagement_signed_at timestamptz,
  add column if not exists engagement_pdf_path text,
  add column if not exists signature_image_path text,
  add column if not exists client_name_snapshot text,
  add column if not exists client_phone_snapshot text;
