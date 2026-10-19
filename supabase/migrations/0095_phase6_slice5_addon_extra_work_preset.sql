-- 0095: Phase 6 Slice 5, mid-case add-on charging on PCH cases.
--
-- The existing case_addons / addon_catalog infrastructure from 0021
-- already supports accountant-requested extras with an admin review
-- gate for custom amounts and auto-approval for preset keys.
--
-- Phase 6 adds the one piece missing from that: a preset for the
-- common "a few quid of extra work, don't need admin approval" case.
-- Price fixed at £50 to keep the auto-approve threshold predictable;
-- anything more expensive still routes through the custom flow where
-- admin signs off.
--
-- Idempotent: insert-on-conflict-do-update so re-running updates copy
-- without duplicating the row.

insert into public.addon_catalog
  (key, name, description, amount_pence, active)
values
  (
    'extra_work_small',
    'Routine extra (small)',
    'Short follow-up task on the case, like redoing one section after a client correction. Flat fee, admin review skipped.',
    5000,
    true
  )
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  amount_pence = excluded.amount_pence,
  active = excluded.active,
  updated_at = now();
