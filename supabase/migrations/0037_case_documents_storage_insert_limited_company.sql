-- Batch 5 follow-up: storage.objects RLS was still gated on
-- cases.status = 'draft', so every post-payment upload failed at
-- `supabase.storage.from('case-documents').upload(...)` *before* the
-- case_documents INSERT (which migration 0033 already opened) ever
-- ran. The upload action does storage first and the DB row second,
-- which is why 0033 looked like it fixed the problem — the DB layer
-- was fine, the storage layer wasn't.
--
-- This migration mirrors 0033's condition over to the three
-- storage.objects policies that write or delete objects in the
-- case-documents bucket:
--
--   client INSERT  → allow personal-flow drafts, allow any paid
--                    limited-company case (server action gates by
--                    onboarding_submitted_at / period_docs_submitted_at
--                    / cycle status, so RLS can be the "is this user
--                    even allowed to touch this bucket on this case")
--   client DELETE  → same window as INSERT so a swap-out works
--   accountant INSERT  → their own assigned case (Batch 4 Annual
--                    Accounts + CT600 and Batch 5 VAT return PDF)
--   accountant DELETE  → their own assigned case
--
-- Read policies (client-own, accountant-assigned, admin-all) are
-- intact and intentionally unchanged — they never had a status gate
-- and reviewers need to see signed URLs across every status.

-- -------- client INSERT --------
drop policy if exists "case-documents_client_upload" on storage.objects;
create policy "case-documents_client_upload" on storage.objects
  for insert with check (
    bucket_id = 'case-documents'
    and exists (
      select 1 from public.cases c
      where c.id::text = (storage.foldername(name))[1]
        and c.client_id = auth.uid()
        and (
          c.status = 'draft'
          or (
            c.segment = 'limited_company_vat'
            and c.stripe_payment_status = 'succeeded'
          )
        )
    )
  );

-- -------- client DELETE --------
drop policy if exists "case-documents_client_delete" on storage.objects;
create policy "case-documents_client_delete" on storage.objects
  for delete using (
    bucket_id = 'case-documents'
    and exists (
      select 1 from public.cases c
      where c.id::text = (storage.foldername(name))[1]
        and c.client_id = auth.uid()
        and (
          c.status = 'draft'
          or (
            c.segment = 'limited_company_vat'
            and c.stripe_payment_status = 'succeeded'
          )
        )
    )
  );

-- -------- accountant INSERT (new) --------
-- Covers uploadAccountantDocumentAction (Annual Accounts, CT600) and
-- uploadVatReturnDocAction (VAT return PDF). RLS only verifies that
-- the file lives under an assigned case's folder; the server actions
-- restrict which requirement_keys / cycle states are permitted.
drop policy if exists "case-documents_accountant_upload" on storage.objects;
create policy "case-documents_accountant_upload" on storage.objects
  for insert with check (
    bucket_id = 'case-documents'
    and exists (
      select 1 from public.cases c
      where c.id::text = (storage.foldername(name))[1]
        and c.accountant_id = auth.uid()
    )
  );

-- -------- accountant DELETE (new) --------
drop policy if exists "case-documents_accountant_delete" on storage.objects;
create policy "case-documents_accountant_delete" on storage.objects
  for delete using (
    bucket_id = 'case-documents'
    and exists (
      select 1 from public.cases c
      where c.id::text = (storage.foldername(name))[1]
        and c.accountant_id = auth.uid()
    )
  );
