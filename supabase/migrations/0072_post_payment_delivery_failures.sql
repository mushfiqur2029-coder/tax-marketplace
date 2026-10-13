-- 0072: Durable marker for post-payment side-effect failures.
--
-- The Stripe webhook's balance branch (and the deposit branch too)
-- performs:
--   1. DB flip (balance_payment_status -> succeeded, status ->
--      filed) with status-filter idempotency so Stripe retries
--      don't double-process.
--   2. Accountant notification insert.
--   3. Client receipt email with branded invoice PDF.
--
-- Steps 2 and 3 run AFTER the DB flip has committed. If the process
-- dies between step 1 and step 2 (OOM, Vercel timeout past the
-- 60s cap, unhandled exception in the notification insert), Stripe
-- retries the webhook. The retry correctly skips the DB flip
-- (idempotent, matches zero rows the second time) and also skips
-- the notification/email steps because they live inside the
-- `if (flipped && flipped.length > 0)` guard. Net result: client's
-- case is paid in the DB, no email, no accountant notification -
-- silent delivery failure that nobody notices until support
-- tickets.
--
-- This table records every post-DB-flip side-effect failure so an
-- admin can see the backlog and manually retry (resend the email,
-- re-fire the notification) rather than discovering the problem by
-- angry email from the client.
--
-- Not a full outbox pattern. We're not re-driving the queue from
-- here, and this table is write-only from the webhook. Admin UI
-- for inspection + manual resolution is a follow-up if volume
-- warrants it; for now the row + its structured error_message /
-- context jsonb are enough to grep logs and act.

create table if not exists public.post_payment_delivery_failures (
  id uuid primary key default gen_random_uuid(),
  -- set null on cascade so the record survives case deletion. We
  -- want these failure rows preserved for audit even if admin
  -- later deletes the case for an unrelated reason.
  case_id uuid references public.cases(id) on delete set null,
  -- 'balance_notification' | 'balance_email' | 'deposit_notification' |
  -- 'deposit_email' - the specific side-effect that failed. Text
  -- rather than enum so adding a new failure site doesn't need
  -- another migration.
  stage text not null,
  error_message text not null,
  -- Free-form context (session id, accountant_id, payment intent,
  -- etc). Keeps the webhook's try/catch simple without inflating
  -- the schema.
  context jsonb,
  created_at timestamptz not null default now(),
  -- Admin manually sets this after acknowledging / retrying.
  -- Querying `where resolved_at is null` gives the pending work queue.
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null
);

create index if not exists post_payment_delivery_failures_unresolved_idx
  on public.post_payment_delivery_failures (created_at desc)
  where resolved_at is null;

create index if not exists post_payment_delivery_failures_case_idx
  on public.post_payment_delivery_failures (case_id)
  where case_id is not null;

alter table public.post_payment_delivery_failures enable row level security;

-- Admins read + resolve. Service role writes (webhook) bypasses RLS.
drop policy if exists "post_payment_failures_admin_select"
  on public.post_payment_delivery_failures;
create policy "post_payment_failures_admin_select"
  on public.post_payment_delivery_failures
  for select
  using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

drop policy if exists "post_payment_failures_admin_update"
  on public.post_payment_delivery_failures;
create policy "post_payment_failures_admin_update"
  on public.post_payment_delivery_failures
  for update
  using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  )
  with check (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );
