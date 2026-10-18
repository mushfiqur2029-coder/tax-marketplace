-- 0089: In-platform case messaging.
--
-- Keeps clarification exchanges (client <-> accountant) attached to the
-- case instead of going over email. Audit requirement: every message
-- must be traceable to a signed-in user, so author_id is NOT NULL and
-- RLS prevents impersonation.
--
-- Schema:
--   id            uuid primary key
--   case_id       FK to cases, cascade on case delete
--   author_id     FK to users, cascade on user delete
--   author_role   'client' | 'accountant' | 'admin', stored at write
--                 time (not derived) so the thread stays readable even
--                 if a user's role changes later
--   body          text (free text, UI enforces non-empty)
--   created_at    timestamptz, auto-populated
--
-- RLS:
--   SELECT: client on own cases, accountant on cases they own, admin
--     via service_role (bypasses RLS)
--   INSERT: client on own cases (as 'client'), accountant on their
--     cases (as 'accountant'). Everything else goes through the
--     service_role admin client in server code.
--
-- Realtime: added to supabase_realtime so both workspaces live-refresh
-- when the other side posts a message.

create table if not exists public.case_messages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  author_id uuid not null references public.users(id) on delete cascade,
  author_role text not null check (author_role in ('client', 'accountant', 'admin')),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists case_messages_case_idx
  on public.case_messages (case_id, created_at);

alter table public.case_messages enable row level security;

create policy case_messages_client_select on public.case_messages
  for select using (
    exists (
      select 1 from public.cases c
      where c.id = case_messages.case_id and c.client_id = auth.uid()
    )
  );
create policy case_messages_client_insert on public.case_messages
  for insert with check (
    author_id = auth.uid()
    and author_role = 'client'
    and exists (
      select 1 from public.cases c
      where c.id = case_messages.case_id and c.client_id = auth.uid()
    )
  );

create policy case_messages_accountant_select on public.case_messages
  for select using (
    exists (
      select 1 from public.cases c
      where c.id = case_messages.case_id and c.accountant_id = auth.uid()
    )
  );
create policy case_messages_accountant_insert on public.case_messages
  for insert with check (
    author_id = auth.uid()
    and author_role = 'accountant'
    and exists (
      select 1 from public.cases c
      where c.id = case_messages.case_id and c.accountant_id = auth.uid()
    )
  );

alter publication supabase_realtime add table public.case_messages;
