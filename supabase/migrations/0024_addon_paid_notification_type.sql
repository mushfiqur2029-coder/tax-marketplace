-- Batch D notification type: addon_paid.
--
-- Fires to the requesting accountant when a client completes payment on an
-- add-on. Wallet-credit trigger for the same event lives in a separate
-- migration (Batch E) so it can be reviewed on its own.

alter type notification_type add value if not exists 'addon_paid';
