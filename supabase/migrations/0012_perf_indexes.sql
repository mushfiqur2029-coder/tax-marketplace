-- Performance: composite indexes covering the hot query paths on cases.
-- The accountant dashboard runs two queries per page load:
--   1) queue:  WHERE status = 'submitted' AND stripe_payment_status = 'succeeded'
--                AND accountant_id IS NULL ORDER BY submitted_at ASC
--   2) mine:   WHERE accountant_id = $1 ORDER BY created_at DESC
--
-- Existing single-column indexes (cases_status_idx, cases_accountant_id_idx)
-- forced a heap fetch + sort. The composites below let the planner satisfy
-- both filter and order from the index alone.

-- (1) Queue: partial index restricted to paid, unassigned queue rows. Tiny in
-- practice (queue drains quickly) and covers the ORDER BY submitted_at ASC.
create index if not exists cases_queue_partial_idx
  on public.cases (submitted_at asc)
  where status = 'submitted'
    and stripe_payment_status = 'succeeded'
    and accountant_id is null;

-- (2) Mine: (accountant_id, created_at DESC) matches the accountant's list
-- ordering exactly. NULLS LAST is the PG default for DESC.
create index if not exists cases_accountant_created_idx
  on public.cases (accountant_id, created_at desc);

-- Messages: the case-detail chat loads messages by case_id then filters by
-- channel. messages_case_id_idx (from 0001) + messages_case_channel_idx
-- (from 0005) already cover this well. Nothing to add here.
