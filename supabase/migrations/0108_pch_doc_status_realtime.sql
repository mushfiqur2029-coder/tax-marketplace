-- Add pch_doc_status to the supabase_realtime publication so the
-- accountant workspace sees "Awaiting accountant" flags land live
-- when the client flips a slot via the client workspace. Without
-- this, the AwaitingAccountantPanel only picks up new blocked slots
-- after a manual refresh.
--
-- Guarded so re-running the migration is a no-op; mirrors the pattern
-- used in 0003/0047/0051/0057/0080 for the other realtime adds.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pch_doc_status'
  ) then
    execute 'alter publication supabase_realtime add table public.pch_doc_status';
  end if;
end$$;
