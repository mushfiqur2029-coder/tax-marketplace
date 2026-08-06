-- Phase 2 schema — service selection, intake, docs, Stripe Checkout.
-- Apply via SQL Editor after 0001_initial_schema.sql.

-- ---------- Case additions ----------
alter table public.cases
  add column if not exists intake_answers jsonb,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists submitted_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

-- Change status default so new draft cases start as 'draft'.
alter table public.cases alter column status set default 'draft';

-- Touch updated_at on any change.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists cases_touch_updated_at on public.cases;
create trigger cases_touch_updated_at
before update on public.cases
for each row execute function public.touch_updated_at();

-- ---------- Helper: is_admin() ----------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.users
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------- RLS: cases ----------
drop policy if exists "cases_client_read_own" on public.cases;
create policy "cases_client_read_own" on public.cases
  for select using (auth.uid() = client_id);

drop policy if exists "cases_client_insert_own" on public.cases;
create policy "cases_client_insert_own" on public.cases
  for insert with check (auth.uid() = client_id);

drop policy if exists "cases_client_update_own_draft" on public.cases;
create policy "cases_client_update_own_draft" on public.cases
  for update
  using (auth.uid() = client_id and status = 'draft')
  with check (auth.uid() = client_id);

-- Accountants: read queue (paid + unassigned) and their assigned cases.
drop policy if exists "cases_accountant_read_queue" on public.cases;
create policy "cases_accountant_read_queue" on public.cases
  for select using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'accountant')
    and (
      (accountant_id is null and status = 'submitted' and stripe_payment_status = 'succeeded')
      or accountant_id = auth.uid()
    )
  );

-- Admin: read anything.
drop policy if exists "cases_admin_read_all" on public.cases;
create policy "cases_admin_read_all" on public.cases
  for select using (public.is_admin());

-- ---------- RLS: case_documents ----------
drop policy if exists "case_documents_client_read_own" on public.case_documents;
create policy "case_documents_client_read_own" on public.case_documents
  for select using (
    exists (select 1 from public.cases c where c.id = case_id and c.client_id = auth.uid())
  );

drop policy if exists "case_documents_client_insert_own" on public.case_documents;
create policy "case_documents_client_insert_own" on public.case_documents
  for insert with check (
    exists (select 1 from public.cases c
            where c.id = case_id
              and c.client_id = auth.uid()
              and c.status = 'draft')
    and uploaded_by = auth.uid()
  );

drop policy if exists "case_documents_client_delete_own_draft" on public.case_documents;
create policy "case_documents_client_delete_own_draft" on public.case_documents
  for delete using (
    exists (select 1 from public.cases c
            where c.id = case_id
              and c.client_id = auth.uid()
              and c.status = 'draft')
  );

drop policy if exists "case_documents_accountant_read_assigned" on public.case_documents;
create policy "case_documents_accountant_read_assigned" on public.case_documents
  for select using (
    exists (select 1 from public.cases c
            where c.id = case_id and c.accountant_id = auth.uid())
  );

drop policy if exists "case_documents_admin_read_all" on public.case_documents;
create policy "case_documents_admin_read_all" on public.case_documents
  for select using (public.is_admin());

-- ---------- Supabase Storage: case-documents bucket ----------
-- The bucket itself must be created in the Supabase Dashboard (Storage → New bucket,
-- name "case-documents", private). These policies control who can read/write objects.

-- Objects live under {caseId}/{filename}. Client owner uploads/reads for their draft;
-- accountant reads assigned; admin reads all.

drop policy if exists "case-documents_client_upload" on storage.objects;
create policy "case-documents_client_upload" on storage.objects
  for insert with check (
    bucket_id = 'case-documents'
    and exists (
      select 1 from public.cases c
      where c.id::text = (storage.foldername(name))[1]
        and c.client_id = auth.uid()
        and c.status = 'draft'
    )
  );

drop policy if exists "case-documents_client_read" on storage.objects;
create policy "case-documents_client_read" on storage.objects
  for select using (
    bucket_id = 'case-documents'
    and exists (
      select 1 from public.cases c
      where c.id::text = (storage.foldername(name))[1]
        and c.client_id = auth.uid()
    )
  );

drop policy if exists "case-documents_client_delete" on storage.objects;
create policy "case-documents_client_delete" on storage.objects
  for delete using (
    bucket_id = 'case-documents'
    and exists (
      select 1 from public.cases c
      where c.id::text = (storage.foldername(name))[1]
        and c.client_id = auth.uid()
        and c.status = 'draft'
    )
  );

drop policy if exists "case-documents_accountant_read" on storage.objects;
create policy "case-documents_accountant_read" on storage.objects
  for select using (
    bucket_id = 'case-documents'
    and exists (
      select 1 from public.cases c
      where c.id::text = (storage.foldername(name))[1]
        and c.accountant_id = auth.uid()
    )
  );

drop policy if exists "case-documents_admin_read" on storage.objects;
create policy "case-documents_admin_read" on storage.objects
  for select using (
    bucket_id = 'case-documents' and public.is_admin()
  );
