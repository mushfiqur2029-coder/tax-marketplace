-- Rate-limit audit trail for the public (un-authenticated) booking
-- endpoint used by the sterlingledger.co.uk /contact page. Each
-- successful POST to /api/public/booking/create writes one row with
-- the client IP + attendee email. The create route reads the table
-- back on every attempt to enforce two caps:
--
--   - per-IP:    at most 5 bookings per rolling hour
--   - per-email: at most 1 booking per rolling 24 hours
--
-- The in-app bespoke LC enquiry picker does NOT write here, since
-- that route is session-gated and the per-user guard already lives
-- on the attendeeEmail-matches-signed-in-user check.
--
-- Service-role writes only (no RLS policies). Users should never see
-- this table.

create table if not exists public.public_booking_attempts (
  id bigserial primary key,
  ip text,
  email text,
  created_at timestamptz not null default now()
);

create index if not exists public_booking_attempts_ip_created_at_idx
  on public.public_booking_attempts (ip, created_at desc);
create index if not exists public_booking_attempts_email_created_at_idx
  on public.public_booking_attempts (email, created_at desc);

alter table public.public_booking_attempts enable row level security;
-- No policies: service role only.
