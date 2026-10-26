-- pch_cases.intake_submitted_at
--
-- Lock the client intake at submit. Prior to this flag, "editable"
-- was gated on cases.status, which stays at 'submitted' for the
-- entire filling period and keeps the client intake editable even
-- after an accountant has claimed the case. The new flag gives us a
-- real "client has handed off, don't touch" boundary independent of
-- the accountant-side status lifecycle.
--
-- Null = still editable. A timestamp = client has submitted; the
-- intake-mutating server actions all refuse once it is set. Only
-- submitForReviewAction stamps it (and only when currently null, so a
-- stale re-submit cannot shift the lock point forward and silently
-- unlock an edit window).
--
-- Backfill: any case where engine_snapshot_at is already set has
-- already been submitted at least once (submitForReviewAction runs
-- the engine); use that timestamp as the historical submission
-- point so existing in-flight cases don't suddenly re-open the
-- intake for the client.

alter table pch_cases
  add column if not exists intake_submitted_at timestamptz;

update pch_cases
  set intake_submitted_at = engine_snapshot_at
  where intake_submitted_at is null
    and engine_snapshot_at is not null;

comment on column pch_cases.intake_submitted_at is
  'Set by submitForReviewAction when the client finalises their intake. Null = still editable. Independent of cases.status so the lock survives the accountant-claim lifecycle.';
