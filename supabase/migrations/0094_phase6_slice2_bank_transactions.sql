-- 0094: Phase 6 Slice 2, bank statement ingest storage.
--
-- Phase 6 shifts income + expense capture from "ask the client to type
-- totals" to "upload a bank statement; we parse every row and the AI
-- categorises each one into a canonical P&L category". The categorised
-- transactions are then aggregated into the existing pch_income_lines
-- and pch_expense_lines tables so the tax engine keeps working with
-- zero changes.
--
-- This migration adds the per-transaction table + indexes + RLS. The
-- parse / categorise / aggregate logic lives in src/lib/pch/bank-*.ts.
--
-- Columns:
--   id                     uuid pk
--   case_id                FK cases, cascade on case delete
--   source_document_id     FK case_documents, set null on doc delete
--                          (keeps the audit trail even if a client
--                          re-uploads and overwrites the file row)
--   txn_date               date, when the transaction cleared
--   description            text, raw merchant / payee / reference as
--                          printed on the statement
--   amount_pence           bigint signed: positive = money in,
--                          negative = money out
--   balance_pence          bigint nullable: running balance where the
--                          statement provides it (not always)
--   category               canonical category key (nullable until the
--                          AI pass runs; see src/lib/pch/bank-categories.ts
--                          for the authoritative key list)
--   category_confidence    'high' | 'medium' | 'low' | 'missing'
--   category_note          one-line AI reasoning for the category pick
--   category_edited_by     user id if a client or accountant overrode
--                          the AI assignment (nullable)
--   category_edited_at     when the override happened
--   raw_json               original parsed row + model output (audit)
--   created_at             when we inserted this row
--
-- RLS: client reads/updates their own case's rows; accountant reads
-- rows on assigned cases. Admin via service_role.

create table if not exists public.pch_bank_transactions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  source_document_id uuid references public.case_documents(id) on delete set null,
  txn_date date,
  description text not null,
  amount_pence bigint not null,
  balance_pence bigint,
  category text,
  category_confidence text check (category_confidence in ('high', 'medium', 'low', 'missing')),
  category_note text,
  category_edited_by uuid references public.users(id),
  category_edited_at timestamptz,
  raw_json jsonb,
  created_at timestamptz not null default now()
);

create index if not exists pch_bank_transactions_case_idx
  on public.pch_bank_transactions (case_id);
create index if not exists pch_bank_transactions_case_date_idx
  on public.pch_bank_transactions (case_id, txn_date);
create index if not exists pch_bank_transactions_document_idx
  on public.pch_bank_transactions (source_document_id);
create index if not exists pch_bank_transactions_uncategorised_idx
  on public.pch_bank_transactions (case_id)
  where category is null;

alter table public.pch_bank_transactions enable row level security;

-- Client: read + update category / edit metadata on their own cases.
-- Inserts always happen server-side via the admin client (bank-trigger
-- orchestration), never from the client.
drop policy if exists pch_bank_transactions_client_select on public.pch_bank_transactions;
create policy pch_bank_transactions_client_select on public.pch_bank_transactions
  for select using (
    exists (
      select 1 from public.cases c
      where c.id = pch_bank_transactions.case_id
        and c.client_id = auth.uid()
    )
  );
drop policy if exists pch_bank_transactions_client_update on public.pch_bank_transactions;
create policy pch_bank_transactions_client_update on public.pch_bank_transactions
  for update using (
    exists (
      select 1 from public.cases c
      where c.id = pch_bank_transactions.case_id
        and c.client_id = auth.uid()
    )
  );

-- Accountant: read on assigned cases. Updates (if any override the
-- category from the accountant side) go via the service_role in
-- accountant actions, same pattern as existing override writes.
drop policy if exists pch_bank_transactions_accountant_select on public.pch_bank_transactions;
create policy pch_bank_transactions_accountant_select on public.pch_bank_transactions
  for select using (
    exists (
      select 1 from public.cases c
      where c.id = pch_bank_transactions.case_id
        and c.accountant_id = auth.uid()
    )
  );

-- Realtime so the client workspace reflects the categorise + edit
-- stream as the AI finishes rows.
alter publication supabase_realtime add table public.pch_bank_transactions;
