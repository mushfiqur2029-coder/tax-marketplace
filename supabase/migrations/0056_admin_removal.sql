-- Infrastructure for the "remove admin" flow at /admin/admins.
--
-- Three parts:
--   1. New admin_action_type enum value 'admin_removed' so the audit
--      trail distinguishes removal from the existing warning/suspend/
--      reinstate actions.
--   2. Relax CASCADE deletes that would either delete the audit trail
--      or block the removal when an admin had history:
--        - admin_actions.admin_id        — preserves audit log entries
--          after the admin is deleted. Column becomes nullable; existing
--          rows unaffected.
--        - admin_actions.target_user_id  — same reasoning for entries
--          where the removed admin was the target.
--        - withdrawal_requests.paid_by   — without SET NULL, deleting
--          an admin who ever marked a payout paid fails with an FK
--          violation. Column was already nullable; this just relaxes
--          the delete semantics.
--   3. Belt-and-braces DB trigger that refuses to DELETE or demote the
--      primary admin, even via direct SQL / service-role access. The
--      application-level guard in removeAdminAction is the first line
--      of defense; this trigger is defense-in-depth so a buggy future
--      action can't take the primary account down.

-- Part 1: enum value ------------------------------------------------
alter type admin_action_type add value if not exists 'admin_removed';

-- Part 2: relax FKs -------------------------------------------------

alter table public.admin_actions
  alter column admin_id drop not null;
alter table public.admin_actions
  alter column target_user_id drop not null;

alter table public.admin_actions
  drop constraint if exists admin_actions_admin_id_fkey;
alter table public.admin_actions
  add constraint admin_actions_admin_id_fkey
    foreign key (admin_id) references public.users(id) on delete set null;

alter table public.admin_actions
  drop constraint if exists admin_actions_target_user_id_fkey;
alter table public.admin_actions
  add constraint admin_actions_target_user_id_fkey
    foreign key (target_user_id) references public.users(id) on delete set null;

alter table public.withdrawal_requests
  drop constraint if exists withdrawal_requests_paid_by_fkey;
alter table public.withdrawal_requests
  add constraint withdrawal_requests_paid_by_fkey
    foreign key (paid_by) references public.users(id) on delete set null;

-- Part 3: primary admin protection trigger --------------------------
--
-- Matches PRIMARY_ADMIN_EMAIL in src/lib/auth.ts. If the email ever
-- needs to change, update both places together — the TS constant for
-- the server-action guard, this trigger for the DB-level guard.

create or replace function public.protect_primary_admin()
returns trigger
language plpgsql
as $$
declare
  v_primary_email constant text := 'ritzbd.com@gmail.com';
begin
  if tg_op = 'DELETE' then
    if old.email = v_primary_email then
      raise exception 'Primary admin % cannot be deleted.', v_primary_email
        using errcode = 'check_violation';
    end if;
    return old;
  elsif tg_op = 'UPDATE' then
    -- Demotion check: can't flip role away from admin, can't change
    -- the email (which would move the "primary" label off this row).
    if old.email = v_primary_email then
      if new.role is distinct from 'admin'::user_role then
        raise exception 'Primary admin %''s role cannot be changed from admin.', v_primary_email
          using errcode = 'check_violation';
      end if;
      if new.email is distinct from old.email then
        raise exception 'Primary admin %''s email cannot be changed.', v_primary_email
          using errcode = 'check_violation';
      end if;
    end if;
    return new;
  end if;
  return null;
end;
$$;

drop trigger if exists protect_primary_admin_trg on public.users;
create trigger protect_primary_admin_trg
  before update or delete on public.users
  for each row execute function public.protect_primary_admin();
