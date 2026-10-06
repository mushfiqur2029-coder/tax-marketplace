-- 'booking_created' notification type: fires when a client books a
-- 15-minute scoping call via the in-app picker so admins + the
-- calendar owner don't miss the "attach a Meet link manually" step
-- (service-account bookings can't attach Meet directly today — see
-- src/lib/calendar/booking.ts for the Option B upgrade note).

do $$ begin
  alter type public.notification_type add value if not exists 'booking_created';
end $$;
