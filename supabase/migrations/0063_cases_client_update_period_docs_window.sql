-- 0063: Open a client UPDATE window on `public.cases` for the
-- period-documents stage of limited-company engagements.
--
-- Same bug class as 0014 and 0039/0046: client-session UPDATEs on
-- cases silently match zero rows under RLS because none of the
-- existing policies cover this stage of the funnel:
--
--   cases_client_update_own_draft  (0002)  status = 'draft'
--   cases_client_approve_own       (0014)  status = 'client_approval'
--   cases_client_update_onboarding (0039/0046)  onboarding_submitted_at IS NULL
--
-- By the time the client reaches period-docs, onboarding has been
-- submitted so onboarding_submitted_at IS NOT NULL, and status is
-- somewhere past 'draft' (typically 'submitted' or 'in_review'), so
-- none of the three policies match. Every UPDATE from the client
-- session (both submitPeriodDocsAction's stamp of period_docs_submitted_at
-- and setPeriodDocNotAvailableAction's merge_case_intake_answers RPC
-- call, which is SECURITY INVOKER and relies on the same RLS gates)
-- hits zero rows. Both server actions correctly detect that and throw
-- the "Submit didn't take. The database refused the write." error the
-- user sees in the UI, but the real fix is to open the window.
--
-- Scope mirrors 0039's shape (not 0046's generalised version) because
-- period docs only exist on the limited_company_vat segment. Personal
-- tiers finish at onboarding and go straight to accountant prep. The
-- segment check keeps the window from inadvertently applying to any
-- future segment that gets added.
--
-- The window closes the moment period_docs_submitted_at is set, same
-- safety shape as 0039 closing on onboarding_submitted_at.

drop policy if exists "cases_client_update_period_docs" on public.cases;
create policy "cases_client_update_period_docs" on public.cases
  for update
  using (
    auth.uid() = client_id
    and segment = 'limited_company_vat'
    and stripe_payment_status = 'succeeded'
    and onboarding_submitted_at is not null
    and period_docs_submitted_at is null
  )
  with check (
    auth.uid() = client_id
  );
