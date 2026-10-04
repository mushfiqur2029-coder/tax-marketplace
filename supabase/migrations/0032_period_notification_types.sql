-- Batch 4 notifications: accountant setting the accounting period
-- (client → fetch the second-stage docs), and client submitting those
-- docs (accountant → start preparing accounts).

alter type notification_type add value if not exists 'case_period_entered';
alter type notification_type add value if not exists 'period_docs_submitted';
