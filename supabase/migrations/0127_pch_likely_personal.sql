-- Phase B UX fix: the bulk-intake review screen was showing every
-- unmatched extracted line (including obvious personal bank
-- transfers) as a permanent full-size card with no way to bulk
-- dismiss them. likely_personal lets the extractor flag a line as
-- clearly not driving-related so the client-facing UI can route it
-- into a collapsed, lower-priority tray instead of the main review
-- list. Defaults false so every existing row (extracted before this
-- column existed) shows up in the main review list unchanged; the
-- client can bulk-dismiss the backlog using the new UI once this
-- ships, no separate backfill needed.
alter table pch_income_lines
  add column if not exists likely_personal boolean not null default false;

alter table pch_expense_lines
  add column if not exists likely_personal boolean not null default false;
