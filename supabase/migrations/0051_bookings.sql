-- Persisted bookings. Written to by /api/booking/create after a Google
-- Calendar event is successfully created, so the client can see "your
-- call is booked" on return visits (not just on the one-off confirmation
-- screen right after booking).
--
-- service_enquiry_id is nullable so this table also hosts bookings
-- made from future surfaces (support calls, accountant consultations)
-- without needing a schema change.
--
-- google_event_id is required: the Google Calendar event is the source
-- of truth for the time + Meet link. We mirror enough here to render
-- the booking without hitting Google on every page load, and to
-- preserve the row if the Google event is deleted or moved later.

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.users(id) on delete cascade,
  service_enquiry_id uuid references public.service_enquiries(id) on delete set null,

  starts_at timestamptz not null,
  ends_at timestamptz not null,
  duration_minutes int not null check (duration_minutes > 0),

  google_event_id text not null,
  google_event_url text,
  meet_link text,

  -- Status transitions as more features land: 'cancelled' once the
  -- client-side cancel flow exists; today we only insert 'confirmed'.
  status text not null default 'confirmed'
    check (status in ('confirmed', 'cancelled')),

  attendee_name text,
  attendee_email text not null,
  service_label text,

  created_at timestamptz not null default now()
);

create index if not exists bookings_client_id_idx on public.bookings (client_id);
create index if not exists bookings_service_enquiry_id_idx on public.bookings (service_enquiry_id);
create index if not exists bookings_starts_at_idx on public.bookings (starts_at);

alter table public.bookings enable row level security;

-- Clients can see their own bookings. Admin + accountant reads go
-- through the service role (same pattern as service_enquiries); no
-- staff-side policy needed here, and inserts come from the server so
-- no insert policy is needed either.
drop policy if exists "bookings_select_own" on public.bookings;
create policy "bookings_select_own" on public.bookings
  for select
  using (client_id = (select auth.uid()));

-- Publish to realtime so the client dashboard's upcoming-calls section
-- refreshes live if a booking happens in another tab, or if admin
-- cancels a booking later from the staff UI.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'bookings'
  ) then
    execute 'alter publication supabase_realtime add table public.bookings';
  end if;
end
$$;
