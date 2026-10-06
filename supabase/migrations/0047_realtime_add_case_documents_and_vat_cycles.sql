-- Add case_documents and vat_return_cycles to the supabase_realtime
-- publication so case detail pages (client / accountant / admin) can
-- react to the other role's uploads and VAT cycle updates without a
-- manual reload.
--
-- Pattern mirrors the existing publication additions in migrations
-- 0003 (cases, messages), 0005 (wallet_transactions, withdrawal_
-- requests), 0008 (pending_profile_changes), 0013 (notifications),
-- 0021 (case_addons, addon_catalog), 0043 (service_enquiries).
--
-- Row-level security filters realtime events the same way it filters
-- SELECTs — admins get all rows, assigned accountants get their own
-- case rows, clients get their own case rows. No new data leaks.

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'case_documents'
  ) then
    execute 'alter publication supabase_realtime add table public.case_documents';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'vat_return_cycles'
  ) then
    execute 'alter publication supabase_realtime add table public.vat_return_cycles';
  end if;
end $$;
