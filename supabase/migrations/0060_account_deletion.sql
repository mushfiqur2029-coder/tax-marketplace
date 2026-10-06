-- Infrastructure for the "permanently delete client / accountant"
-- flow at /admin/clients/<id> and /admin/accountants/<id>.
--
-- Two parts:
--   1. New admin_action_type enum value 'account_deleted' so the
--      audit trail distinguishes account deletion from the existing
--      warning/suspend/reinstate/admin_removed actions.
--   2. Relax case_documents.uploaded_by from ON DELETE CASCADE to
--      ON DELETE SET NULL.
--
-- Why relax uploaded_by: an accountant can be assigned to a case
-- and upload documents against it (migration 0038's RLS policy),
-- while cases.accountant_id is already ON DELETE SET NULL so the
-- case itself survives their deletion. If uploaded_by stays CASCADE,
-- deleting an accountant would silently drop every case_documents
-- row they ever uploaded — including on surviving cases owned by
-- someone else — leaving holes in document history + orphaned
-- storage files that no DB row references.
--
-- The pre-check in deleteAccountantAccountAction still refuses to
-- delete an accountant with wallet / withdrawal / add-on / VAT-cycle
-- rows on record, so the SET NULL doesn't make it easier to delete
-- accounts with financial history — it only makes the already-safe
-- case (zero financial rows) actually safe for case documents too.

-- Part 1: enum value ------------------------------------------------
alter type admin_action_type add value if not exists 'account_deleted';

-- Part 2: relax case_documents.uploaded_by FK -----------------------
--
-- The column stays NOT NULL at write time — RLS policies that filter
-- on `uploaded_by = auth.uid()` keep working for live users. SET NULL
-- only kicks in when the referenced user row disappears, which only
-- happens via the primary-admin deletion flow (or the admin removal
-- flow for admins, which never applies to uploader users). Setting
-- the column nullable is required so Postgres can accept the SET NULL
-- action; the application never writes NULL deliberately.
alter table public.case_documents
  alter column uploaded_by drop not null;

alter table public.case_documents
  drop constraint if exists case_documents_uploaded_by_fkey;

alter table public.case_documents
  add constraint case_documents_uploaded_by_fkey
    foreign key (uploaded_by) references public.users(id) on delete set null;
