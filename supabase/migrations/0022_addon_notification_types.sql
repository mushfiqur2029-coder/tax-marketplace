-- Extend notification_type enum with the add-on flow's first event.
--
-- Only addon_pending_admin is added here (Batch B, custom add-on requests
-- that need admin review). Later batches add addon_ready_to_pay,
-- addon_paid, and addon_review_decision as those flows come online, in
-- the same incremental style as 0016 (case_reassigned + approval).

alter type notification_type add value if not exists 'addon_pending_admin';
