-- Client-facing notifications for the two enquiry-status transitions
-- admin can drive from /admin/enquiries. A client submitting a bespoke
-- enquiry shouldn't be left wondering what happened — "contacted" and
-- "closed" both get surfaced in the client's bell.
--
-- Admin side already has notify_service_enquiry fanning the initial
-- 'service_enquiry' notification to admins; the two below are the
-- client-facing complement.

alter type public.notification_type add value if not exists 'enquiry_contacted';
alter type public.notification_type add value if not exists 'enquiry_closed';
