-- Urgent deadlines: cases can be booked as urgent for an extra fee.
--
-- Two columns on cases:
--   is_urgent           set at booking, immutable once paid
--   urgent_fee_pence    the fee at the time of booking (currently £100),
--                       stored per-row so future price changes don't
--                       retroactively rewrite historic case pricing or
--                       wallet splits
--
-- Existing rows: default false / 0. No touch to their deadlines.
-- Wallet-split trigger update lives in a separate migration (0020) so it
-- can be reviewed on its own.

alter table public.cases
  add column if not exists is_urgent boolean not null default false,
  add column if not exists urgent_fee_pence integer not null default 0
    check (urgent_fee_pence >= 0);
