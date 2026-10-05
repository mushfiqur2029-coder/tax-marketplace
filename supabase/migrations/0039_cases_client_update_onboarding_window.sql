-- Fix: onboarding fields (text / select / date) showed filled-in
-- values on screen but every one of them was reported as "still
-- missing" on submit, because cases.intake_answers was still null
-- in the DB. Root cause is the same silent-match-zero-rows RLS trap
-- that migration 0014 fixed for the client_approval → filed
-- transition — never generalised to the post-pay onboarding window.
--
-- `cases_client_update_own_draft` (from 0002) requires status='draft'.
-- Payment flips status to 'submitted', so the moment the client
-- lands on the onboarding form every UPDATE from their session hits
-- zero rows under RLS; PostgREST returns {error:null,data:null}
-- which looks successful, the server action returned ok, and the
-- form's save-on-change / blur handlers appeared to persist state
-- that was in fact only in React state. Reload = loss.
--
-- Mirrors the shape of 0033 (case_documents) and 0037 (storage.objects)
-- fixes: open the limited-company paid window as a NEW permissive
-- policy, additive to the existing draft and client_approval policies,
-- so the pre-existing update paths stay as they were.
--
-- Scoped by `onboarding_submitted_at is null` so after the client
-- submits onboarding they can no longer rewrite intake_answers via
-- a crafted REST call — the server action still gates WHICH columns
-- it writes, this policy gates WHEN clients can write at all.

drop policy if exists "cases_client_update_onboarding" on public.cases;
create policy "cases_client_update_onboarding" on public.cases
  for update
  using (
    auth.uid() = client_id
    and segment = 'limited_company_vat'
    and stripe_payment_status = 'succeeded'
    and onboarding_submitted_at is null
  )
  with check (
    auth.uid() = client_id
  );
