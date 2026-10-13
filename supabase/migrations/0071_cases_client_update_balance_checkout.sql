-- 0071: Open a client UPDATE window on cases for the bespoke
-- balance-checkout session id write.
--
-- Same bug class as 0063 for period-docs:
-- startBalanceCheckoutAction and the balance branch of
-- approveAndFileAction (src/app/client/actions.ts) write
-- balance_stripe_checkout_session_id while status = 'client_approval'
-- so the webhook can later match the session back to the case. The
-- client-session supabase client is RLS-gated; none of the existing
-- policies permit this write:
--
--   cases_client_update_own_draft (0002)  status = 'draft' only
--   cases_client_approve_own     (0014)  USING status='client_approval'
--                                        WITH CHECK status='filed'
--                                        - the WITH CHECK forces the
--                                        new row to be at 'filed', so
--                                        a session-id write that
--                                        leaves status='client_approval'
--                                        fails the policy and matches
--                                        zero rows.
--   cases_client_update_onboarding (0039/0046) onboarding_submitted_at IS NULL
--   cases_client_update_period_docs (0063) period_docs_submitted_at IS NULL
--
-- Result: the UPDATE silently 0-rows. The approveAndFileAction
-- redirect to Stripe still happens (the Checkout session is created
-- regardless), but balance_stripe_checkout_session_id stays NULL on
-- the case row. When Stripe fires the webhook, the balance branch
-- matches on session.metadata.payment_kind='bespoke_balance' + case_id
-- rather than on the stored session id, so the webhook still fires
-- correctly. But the client-page "Pay balance" retry banner and the
-- reconcileBalancePaymentAction fallback both read
-- balance_stripe_checkout_session_id and treat NULL as "no session
-- yet open", which gives inconsistent recovery UX.
--
-- Fix: new permissive UPDATE policy for the window that
-- balance-checkout writes legitimately happen in -
-- status='client_approval', balance_pence > 0, balance not yet paid.
-- WITH CHECK keeps status at 'client_approval' so this policy can
-- only widen the balance-related columns, never advance the case
-- status. The approve->filed transition stays with 0014.

drop policy if exists "cases_client_update_balance_checkout" on public.cases;
create policy "cases_client_update_balance_checkout" on public.cases
  for update
  using (
    auth.uid() = client_id
    and status = 'client_approval'
    and balance_pence is not null
    and balance_pence > 0
    and (
      balance_payment_status is null
      or balance_payment_status <> 'succeeded'
    )
  )
  with check (
    auth.uid() = client_id
    and status = 'client_approval'
  );
