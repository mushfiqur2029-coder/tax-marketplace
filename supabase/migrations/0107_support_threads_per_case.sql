-- 0107: Phase 7 Slice 7.3b, pivot support_threads to per-case scope.
--
-- 7.3a shipped one thread per user (standalone /help page). Live
-- feedback: support should sit inside the case workspace next to the
-- accountant chat, as a tab, so case context travels with the
-- conversation and client/accountant private privacy is preserved
-- (the client venting about the accountant shouldn't show up in the
-- accountant's own tab).
--
-- Shape change: one thread per (case, user). A case can have 0 to 2
-- threads (client's and accountant's), both scoped to that case.
--
-- Discarded data: the 7.3a UNIQUE(user_id) thread row(s) have no
-- case_id and can't be backfilled meaningfully. Rows are deleted
-- before the NOT NULL step; ON DELETE CASCADE on support_messages
-- removes any messages they carried.

-- Step 1: nullable case_id column
alter table public.support_threads
  add column if not exists case_id uuid;

-- Step 2: drop orphan 7.3a rows (no case association).
-- support_messages cascade-deletes via existing FK.
delete from public.support_threads where case_id is null;

-- Step 3: enforce NOT NULL + FK
alter table public.support_threads
  alter column case_id set not null;

alter table public.support_threads
  add constraint support_threads_case_id_fkey
  foreign key (case_id) references public.cases(id) on delete cascade;

-- Step 4: swap uniqueness constraint. Drop UNIQUE(user_id) if present
-- (name convention: supabase auto-names it <table>_<column>_key) and
-- add the composite per-case-per-user constraint.
alter table public.support_threads
  drop constraint if exists support_threads_user_id_key;

alter table public.support_threads
  add constraint support_threads_case_user_key
  unique (case_id, user_id);

-- Step 5: index for admin inbox / per-case lookups
create index if not exists support_threads_case_user_idx
  on public.support_threads (case_id, user_id);

-- RLS unchanged: user_id = auth.uid() stays as the owner read/write
-- guard. The server action getOrCreateCaseSupportThreadAction is
-- responsible for verifying the caller is client or accountant on the
-- target case before inserting a row.
