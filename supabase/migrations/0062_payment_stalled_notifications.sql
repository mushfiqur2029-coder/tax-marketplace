-- Admin-visible notification types for failed / expired Stripe
-- Checkout sessions. Fire from the webhook when a session reaches
-- `checkout.session.expired` or `checkout.session.async_payment_failed`
-- and the DB flip actually transitions a row (idempotent gate in the
-- webhook; this enum change on its own is a no-op until paired with
-- the webhook update).
--
-- Two distinct types so the bell routes differently:
--   case_payment_stalled   → /admin/cases/<id>
--   addon_payment_stalled  → /admin/cases/<id> + add-on scrolls into
--                            view (same page houses both)
-- Separate enum values also keep the UI copy specific — a case
-- stall triggers a deletion threat for the client, an add-on stall
-- doesn't, so bundling them under one type would make the admin
-- bell confusing.

alter type public.notification_type add value if not exists 'case_payment_stalled';
alter type public.notification_type add value if not exists 'addon_payment_stalled';
