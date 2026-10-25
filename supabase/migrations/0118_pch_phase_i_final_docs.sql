-- Phase I: accountant-portal rebuild, the 4-document send/approve/file flow.
-- New, cleanly-named columns; the old final_pack_sent_at / final_pack_confirmed_at /
-- bookkeeping_confirmed_at columns are left in place (other code may still read them)
-- but the Phase I accountant UI does not write to them.

alter table pch_cases
  add column if not exists pl_confirmed_at timestamptz,
  add column if not exists pl_confirmed_by uuid references users(id),
  add column if not exists sa_forwarding_pdf_path text,
  add column if not exists pch_accounts_pdf_path text,
  add column if not exists sa302_upload_path text,
  add column if not exists sa100_upload_path text,
  add column if not exists docs_ready_at timestamptz,
  add column if not exists docs_sent_for_approval_at timestamptz,
  add column if not exists client_approved_at timestamptz,
  add column if not exists client_approved_signature_name text;
