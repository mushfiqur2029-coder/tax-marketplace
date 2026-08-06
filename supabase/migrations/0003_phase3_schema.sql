-- Phase 3 schema — messages RLS + Realtime publications for chat and queue notifications.
-- Apply after 0002_phase2_schema.sql.

-- ---------- RLS: messages ----------
-- A message is visible to the client, the assigned accountant, and admins.
drop policy if exists "messages_read_case_parties" on public.messages;
create policy "messages_read_case_parties" on public.messages
  for select using (
    exists (
      select 1 from public.cases c
      where c.id = case_id
        and (
          c.client_id = auth.uid()
          or c.accountant_id = auth.uid()
          or public.is_admin()
        )
    )
  );

drop policy if exists "messages_insert_case_parties" on public.messages;
create policy "messages_insert_case_parties" on public.messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.cases c
      where c.id = case_id
        and (
          c.client_id = auth.uid()
          or c.accountant_id = auth.uid()
        )
    )
  );

-- Prevent editing / deleting historical messages (chat is append-only for now).

-- ---------- Realtime publication ----------
-- Realtime works by streaming from a Postgres publication called supabase_realtime.
-- Both cases (for the notification bell) and messages (for chat) need to be in it.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cases'
  ) then
    execute 'alter publication supabase_realtime add table public.cases';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end
$$;

-- Send full row on updates so realtime clients can filter by status changes.
alter table public.cases replica identity full;
alter table public.messages replica identity full;
