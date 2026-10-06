-- Personal onboarding was blocked by RLS. The five policies written
-- during the Limited Company build (migrations 0033, 0037, 0039) were
-- scoped specifically to segment = 'limited_company_vat' instead of
-- generically to "any paid case in its onboarding window". With
-- segment = 'personal' live (migration 0045), those same policies
-- silently filter Personal cases out:
--
--   - "Save didn't take, the database refused the write" on the
--     Personal UTR (sa_utr) text field save — same shape as 0039.
--   - "new row violates row-level security policy" on Personal
--     document upload (sa_ni_proof etc.) — same shape as 0033 and
--     0037 at the DB layer and the storage layer respectively.
--
-- The server actions (saveChecklistAnswersAction,
-- uploadChecklistDocumentAction, removeChecklistDocumentAction,
-- submitChecklistAction in src/app/client/onboarding-actions.ts)
-- already enforce the fine-grained rules — which columns to merge,
-- which requirement_keys are valid for the tier, which slots are
-- still open — so RLS only needs to gate "is this client authorised
-- to touch this case's intake / documents at all". Opening the
-- window on payment and closing it on onboarding submit keeps RLS
-- as a coarse gate without widening what server-side code allows.
--
-- Pattern lifted verbatim from the Limited Company build: 0033's
-- paid-window branch, 0039's onboarding_submitted_at closing gate.
-- We just drop the segment check so both flows go through the same
-- policies. Retired-personal segments (first_time_filer / self_
-- employed / landlord / investor / cis / high_earner) have no case
-- rows after the P1 data wipe, so widening is zero-blast-radius.

-- -------- cases: client UPDATE during onboarding (0039 generalised) --------
drop policy if exists "cases_client_update_onboarding" on public.cases;
create policy "cases_client_update_onboarding" on public.cases
  for update
  using (
    auth.uid() = client_id
    and stripe_payment_status = 'succeeded'
    and onboarding_submitted_at is null
  )
  with check (
    auth.uid() = client_id
  );

-- -------- case_documents: client INSERT (0033 generalised) --------
drop policy if exists "case_documents_client_insert_own" on public.case_documents;
create policy "case_documents_client_insert_own" on public.case_documents
  for insert with check (
    exists (
      select 1 from public.cases c
      where c.id = case_id
        and c.client_id = auth.uid()
        and (
          -- Pre-pay drafts (both flows upload here if they want
          -- before paying; the new catalogue happens not to, but
          -- the policy stays flow-agnostic).
          c.status = 'draft'
          -- Any paid case still in its onboarding window. Server
          -- action enforces which slots are open per tier.
          or c.stripe_payment_status = 'succeeded'
        )
    )
    and uploaded_by = auth.uid()
  );

-- -------- case_documents: client DELETE (0033 generalised) --------
drop policy if exists "case_documents_client_delete_own" on public.case_documents;
create policy "case_documents_client_delete_own" on public.case_documents
  for delete using (
    exists (
      select 1 from public.cases c
      where c.id = case_id
        and c.client_id = auth.uid()
        and (
          c.status = 'draft'
          or c.stripe_payment_status = 'succeeded'
        )
    )
  );

-- -------- storage.objects: client INSERT (0037 generalised) --------
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
          or c.stripe_payment_status = 'succeeded'
        )
    )
  );

-- -------- storage.objects: client DELETE (0037 generalised) --------
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
          or c.stripe_payment_status = 'succeeded'
        )
    )
  );
