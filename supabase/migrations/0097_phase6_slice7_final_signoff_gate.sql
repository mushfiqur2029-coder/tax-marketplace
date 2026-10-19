-- 0097: Phase 6 Slice 7, final sign-off gate between client approval
-- and HMRC submission.
--
-- Phase 5 ended the client's journey with a single approval step
-- (pch_cases.client_approval_* set) before the accountant pressed
-- "File with HMRC". Phase 6 splits that into two moments:
--
--   1. Client approves the figures  (client_approval_at, as today).
--   2. Accountant sends the final accounts pack to the client
--      (final_pack_sent_at) and the client reviews the actual PDF
--      and confirms (final_pack_confirmed_at + name).
--   3. Only once both of the above are set does the accountant get
--      the "Mark filed with HMRC" button.
--
-- Deliberately uses sidecar columns on pch_cases rather than a new
-- cases.status enum value so the existing status-driven UI, status
-- notifications, and queue filters stay unchanged. "Filed" still
-- means "accountant has submitted to HMRC".

alter table public.pch_cases
  add column if not exists final_pack_sent_at timestamptz,
  add column if not exists final_pack_sent_by uuid references public.users(id),
  add column if not exists final_pack_confirmed_at timestamptz,
  add column if not exists final_pack_confirmed_name text;
