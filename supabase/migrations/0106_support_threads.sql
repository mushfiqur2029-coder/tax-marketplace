-- 0106: Phase 7 Slice 7.3, admin / support contact channel.
--
-- Non-case-bound chat between any signed-in user (client or accountant)
-- and the admin team. Fills the gap left by case_messages, which only
-- threads conversations against a specific case: a client with a
-- billing or login problem had nowhere to go, same for an accountant
-- with a payout question or platform bug report.
--
-- One thread per user keeps the admin inbox linear ("iMessage with
-- support") rather than fragmenting the same user across tickets. If
-- support volume justifies per-topic threads later, add a "new thread"
-- button plus relax the unique constraint; nothing else needs to move.
--
-- Separate tables (not synthetic cases) so every case-scoped query
-- in the app stays untouched; no "WHERE tier != 'support'" guards
-- needed anywhere.
--
-- RLS: thread owner can read own thread + its messages, and insert
-- messages on it. All admin reads + writes go through the service_role
-- admin client in server code (bypasses RLS). Admin never appears in
-- an owner-side policy; keeping the admin surface server-only avoids
-- accidental cross-tenant leaks through a client-side query.

-- -------------------------------------------------------------------
-- Tables
-- -------------------------------------------------------------------
create table if not exists public.support_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  user_role text not null check (user_role in ('client', 'accountant')),
  status text not null default 'open' check (status in ('open', 'resolved')),
  -- Nullable: unassigned threads surface to any admin in the inbox.
  assigned_admin_id uuid references public.users(id) on delete set null,
  -- Last message timestamp, maintained by the server action on each
  -- insert, used to sort the admin inbox (most recent first).
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One ongoing thread per user: Slice 7.3 MVP shape.
  unique (user_id)
);

create index if not exists support_threads_inbox_idx
  on public.support_threads (status, last_message_at desc nulls last);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.support_threads(id) on delete cascade,
  author_id uuid not null references public.users(id) on delete cascade,
  author_role text not null check (author_role in ('client', 'accountant', 'admin')),
  body text not null,
  -- Mirrors case_messages.attachments shape: jsonb array of
  -- { path, name, mime, size_bytes } so renderers show chips without
  -- a join. Null for text-only messages. Storage objects live under
  -- the case-documents bucket at support/{thread_id}/{msg_id}/{file}.
  attachments jsonb,
  created_at timestamptz not null default now()
);

create index if not exists support_messages_thread_idx
  on public.support_messages (thread_id, created_at);

-- -------------------------------------------------------------------
-- RLS
-- -------------------------------------------------------------------
alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;

-- Thread owner can SELECT their own thread row (lets the client-side
-- panel read status + assignment metadata directly if needed).
create policy support_threads_owner_select on public.support_threads
  for select using (user_id = auth.uid());

-- Owner can SELECT every message on their own thread.
create policy support_messages_owner_select on public.support_messages
  for select using (
    exists (
      select 1 from public.support_threads t
      where t.id = support_messages.thread_id and t.user_id = auth.uid()
    )
  );

-- Owner can INSERT their own messages. Admin inserts go through the
-- service_role admin client in sendAdminSupportReplyAction, which
-- bypasses RLS; no owner-side admin-insert policy is required.
create policy support_messages_owner_insert on public.support_messages
  for insert with check (
    author_id = auth.uid()
    and author_role in ('client', 'accountant')
    and exists (
      select 1 from public.support_threads t
      where t.id = support_messages.thread_id and t.user_id = auth.uid()
    )
  );

-- -------------------------------------------------------------------
-- Realtime
-- -------------------------------------------------------------------
-- Add support_messages to the realtime publication so the chat panel
-- live-refreshes when the other side posts. support_threads changes
-- rarely (status flips, assignment) so skip the subscription there;
-- an admin resolve nudges the client via a notification instead.
alter publication supabase_realtime add table public.support_messages;

-- -------------------------------------------------------------------
-- Notification type
-- -------------------------------------------------------------------
alter type notification_type add value if not exists 'new_support_message';
