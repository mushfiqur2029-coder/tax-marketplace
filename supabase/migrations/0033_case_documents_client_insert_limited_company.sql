-- Batch 4 fix (also required for Batch 3's onboarding uploads):
-- the client's case_documents insert + delete policies were pinned to
-- status='draft'. That matches the personal flow (intake → documents →
-- checkout where status flips to 'submitted' only on pay), but it
-- blocks every post-payment upload in the limited-company flow —
-- onboarding (Sections A/B/C/[D]) AND period docs. The server actions
-- that call these inserts/deletes already enforce the fine-grained
-- "is this slot open right now?" rules (onboarding_submitted_at not
-- set, period_docs_submitted_at not set, etc.), so RLS only needs to
-- gate "is this client authorised to touch case_documents on this
-- case at all". Opening the policy for paid limited-company cases
-- removes the production block without widening the attack surface.
--
-- Caught by the Batch 4 DB/API E2E — client inserts failed with
-- "new row violates row-level security policy for table
-- case_documents" even on paid cases past onboarding.

drop policy if exists "case_documents_client_insert_own" on public.case_documents;
create policy "case_documents_client_insert_own" on public.case_documents
  for insert with check (
    exists (
      select 1 from public.cases c
      where c.id = case_id
        and c.client_id = auth.uid()
        and (
          -- Personal-flow uploads happen pre-pay at status='draft'.
          c.status = 'draft'
          -- Limited-company clients upload AFTER payment (onboarding
          -- + period docs). The server-side action still enforces
          -- whether the specific slot is open: onboarding gates on
          -- onboarding_submitted_at, period-docs gates on
          -- period_docs_submitted_at + period_start_date.
          or (
            c.segment = 'limited_company_vat'
            and c.stripe_payment_status = 'succeeded'
          )
        )
    )
    and uploaded_by = auth.uid()
  );

drop policy if exists "case_documents_client_delete_own_draft" on public.case_documents;
drop policy if exists "case_documents_client_delete_own" on public.case_documents;
create policy "case_documents_client_delete_own" on public.case_documents
  for delete using (
    exists (
      select 1 from public.cases c
      where c.id = case_id
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
