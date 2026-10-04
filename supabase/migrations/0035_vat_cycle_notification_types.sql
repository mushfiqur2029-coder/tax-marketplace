-- Batch 5 notifications: VAT return cycle lifecycle events.
--
--  vat_cycle_opened       — accountant set the first period end date (or
--                           the system auto-created the next cycle on
--                           approve-and-file). Client needs to upload.
--  vat_docs_submitted     — client submitted the per-cycle uploads.
--                           Assigned accountant can start preparing.
--  vat_approval_ready     — accountant sent the cycle for client
--                           approval (box 1-9 payload + return PDF).
--  vat_filed              — client approved and filed. Previous cycle
--                           is terminal; next cycle has auto-created.

alter type notification_type add value if not exists 'vat_cycle_opened';
alter type notification_type add value if not exists 'vat_docs_submitted';
alter type notification_type add value if not exists 'vat_approval_ready';
alter type notification_type add value if not exists 'vat_filed';
