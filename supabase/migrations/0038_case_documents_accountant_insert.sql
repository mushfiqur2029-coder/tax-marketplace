-- Follow-up to 0037: the storage.objects gap was only half the story.
-- Accountants had no INSERT or DELETE policy on the case_documents
-- TABLE itself (the original 0002 schema only granted them READ on
-- their assigned cases). That means every accountant upload path we
-- shipped — Batch 4 Annual Accounts + CT600, Batch 5 VAT return PDF
-- — would fail at the DB layer the moment anyone exercised them in
-- production, with "new row violates row-level security policy for
-- table case_documents". The uploads-sweep E2E caught all three.
--
-- RLS gates "is this accountant allowed to touch this case's docs
-- at all". The server actions keep enforcing the finer rules:
-- uploadAccountantDocumentAction allowlists the Annual Accounts /
-- CT600 requirement_keys; uploadVatReturnDocAction allowlists the
-- VAT return PDF; the remove counterparts check uploaded_by = me.id
-- + the requirement_key stays within the accountant's allowed set.

drop policy if exists "case_documents_accountant_insert_assigned" on public.case_documents;
create policy "case_documents_accountant_insert_assigned" on public.case_documents
  for insert
  with check (
    exists (
      select 1 from public.cases c
      where c.id = case_id
        and c.accountant_id = auth.uid()
    )
    and uploaded_by = auth.uid()
  );

drop policy if exists "case_documents_accountant_delete_assigned" on public.case_documents;
create policy "case_documents_accountant_delete_assigned" on public.case_documents
  for delete
  using (
    exists (
      select 1 from public.cases c
      where c.id = case_id
        and c.accountant_id = auth.uid()
    )
  );
