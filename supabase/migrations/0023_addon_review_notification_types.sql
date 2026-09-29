-- Batch C notification types.
--
-- addon_ready_to_pay      -> client, when an add-on lands at pending_payment.
--                            Fires for both preset (immediately after the
--                            accountant requests it) and custom (once admin
--                            approves it).
-- addon_review_decision   -> accountant, when admin approves or rejects a
--                            custom add-on. One type covering both
--                            outcomes, matching how accountant_approval_
--                            decision handles approved/rejected in one
--                            enum value.

alter type notification_type add value if not exists 'addon_ready_to_pay';
alter type notification_type add value if not exists 'addon_review_decision';
