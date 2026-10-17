-- Add a jsonb column to pch_cases to persist the SA302 reconciliation
-- values the accountant pastes in from their filing software. Lives on
-- the head row (one SA302 per case) rather than a child table because
-- the comparison is a point-in-time snapshot and never has history we
-- care about keeping.
--
-- Shape, written by savePchSa302ComparisonAction:
--   {
--     "box9_turnover": 23199,
--     "box12_carVanTravel": 10896,
--     ... (every SA103S box in the compare catalogue)
--     "sa302_self_employment_profit": 11124,
--     "sa302_income_tax": 0,
--     "sa302_class4": 0,
--     "sa302_balancing_payment": 0,
--     "sa302_poa_each": 0,
--     "recorded_at": "2026-11-05T12:34:56Z",
--     "recorded_by": "<user uuid>"
--   }
-- The keys mirror src/lib/pch/sa302.ts SA302_COMPARE_FIELDS exactly.
-- Values are stored as numbers; nulls are allowed per field (the
-- accountant may paste only the boxes they have).

alter table public.pch_cases
  add column if not exists sa302_comparison jsonb;
