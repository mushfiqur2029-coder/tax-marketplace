-- Hotfix: accountants need UPDATE permission on cases to (a) take an unassigned
-- case from the queue, and (b) advance the status on a case they've taken.

drop policy if exists "cases_accountant_update_queue_or_own" on public.cases;
create policy "cases_accountant_update_queue_or_own" on public.cases
  for update
  using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'accountant')
    and (
      -- Taking an unassigned paid case from the queue
      (accountant_id is null and status = 'submitted' and stripe_payment_status = 'succeeded')
      -- Or updating a case already assigned to this accountant
      or accountant_id = auth.uid()
    )
  )
  with check (
    -- After the update the case must be owned by this accountant
    accountant_id = auth.uid()
  );
