-- 0088: Throttle marker for missing-document reminder emails.
--
-- The daily cron that nudges a client to upload still-missing required
-- documents writes this timestamp when it sends. The next sweep checks
-- it to enforce a 7-day gap between reminders per case, so a slow
-- client gets a weekly nudge, not a daily spam.
--
-- Nullable; a NULL means we've never reminded this case. The cron
-- condition is: last_doc_reminder_at IS NULL OR last_doc_reminder_at
-- < now() - interval '7 days'.

alter table public.cases
  add column if not exists last_doc_reminder_at timestamptz;
