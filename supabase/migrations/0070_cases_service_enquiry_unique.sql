-- 0070: One case per service_enquiry.
--
-- createBespokeCaseFromEnquiryAction had no uniqueness guarantee on
-- cases.service_enquiry_id. If an admin double-clicked the "Create
-- case" button, or two admins opened the same enquiry at once, both
-- requests could succeed and leave two cases pointing at the same
-- enquiry row. The client would then see two quotes in their bell,
-- both bills come due, and the admin audit note gets confused.
--
-- Fix: unique constraint on cases.service_enquiry_id. Postgres
-- allows multiple NULLs in a standard UNIQUE by default, so every
-- non-bespoke case (service_enquiry_id IS NULL) is unaffected -
-- only the explicit enquiry links are deduped.
--
-- Also: the TS action in src/app/admin/actions.ts gains an explicit
-- pre-insert check that returns a clean "Enquiry already closed or
-- already has a case" error, so the user sees a sensible message
-- instead of a bare Postgres unique-violation.
--
-- If this migration ever fails on an existing project it means a
-- duplicate pair already exists in the wild. Resolve by picking
-- the correct case (usually the earlier created_at) and NULLing
-- service_enquiry_id on the other, OR deleting the duplicate case
-- outright - whichever matches the business state.

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cases_service_enquiry_id_key'
  ) then
    alter table public.cases
      add constraint cases_service_enquiry_id_key
      unique (service_enquiry_id);
  end if;
end $$;
