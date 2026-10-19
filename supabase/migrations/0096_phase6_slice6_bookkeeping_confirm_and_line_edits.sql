-- 0096: Phase 6 Slice 6, "accountant confirmed auto bookkeeping" gate
-- + line-item edit audit on pch_income_lines / pch_expense_lines.
--
-- Phase 6 adds a one-click "Confirm auto bookkeeping" step in the
-- accountant workflow. Before confirmation, the accountant sees the
-- AI-built ledger (read-only review). After confirmation, the full
-- P&L edit grid becomes editable with the per-line edit audit this
-- migration adds.
--
-- Three changes:
--
--   1. pch_cases picks up bookkeeping_confirmed_at + _by, nullable;
--      set by confirmBookkeepingAction, cleared by revert.
--
--   2. pch_income_lines + pch_expense_lines get three sidecar columns
--      per row:
--        ai_proposed_json jsonb, snapshot of the row as the bank
--                                aggregator originally inserted it
--                                (for the AI-vs-edited diff view).
--        edited_by uuid,         accountant who last changed the row.
--        edited_at timestamptz,  when the last change happened.
--      Nulls on both _by and _at mean "untouched by human; AI
--      aggregate is still authoritative." Nulls on ai_proposed_json
--      mean the row was created outside the bank aggregator (manual
--      entry or an older migration) and has no AI baseline to diff
--      against.
--
-- Idempotent across the three alters.

-- (1) bookkeeping confirm columns.
alter table public.pch_cases
  add column if not exists bookkeeping_confirmed_at timestamptz,
  add column if not exists bookkeeping_confirmed_by uuid references public.users(id);

-- (2a) pch_income_lines line-edit audit.
alter table public.pch_income_lines
  add column if not exists ai_proposed_json jsonb,
  add column if not exists edited_by uuid references public.users(id),
  add column if not exists edited_at timestamptz;

-- (2b) pch_expense_lines line-edit audit.
alter table public.pch_expense_lines
  add column if not exists ai_proposed_json jsonb,
  add column if not exists edited_by uuid references public.users(id),
  add column if not exists edited_at timestamptz;
