-- Fix: client can move a case from client_approval -> filed.
--
-- Previously the only client UPDATE policy on public.cases required
-- status = 'draft' (from 0002_phase2_schema.sql:cases_client_update_own_draft),
-- so when a client clicked "Approve and file" the UPDATE matched zero rows
-- under RLS. PostgREST returns success with 0 rows affected in that case,
-- so the server action returned "ok" without changing anything and the page
-- reloaded with the same client_approval status.
--
-- This policy narrowly permits the one legitimate client-side transition:
--   client_approval  ->  filed
-- The WITH CHECK ensures the client cannot rewrite the row to any other
-- status (e.g. skipping straight to 'complete') via a crafted request.

drop policy if exists "cases_client_approve_own" on public.cases;
create policy "cases_client_approve_own" on public.cases
  for update
  using (
    auth.uid() = client_id
    and status = 'client_approval'
  )
  with check (
    auth.uid() = client_id
    and status = 'filed'
  );
