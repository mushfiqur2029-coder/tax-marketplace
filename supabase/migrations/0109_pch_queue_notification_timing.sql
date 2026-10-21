-- Fix PCH accountant-queue notification timing.
--
-- notify_case_change() used to fire 'new_queue_case' for every tier,
-- including PCH automated, the moment a case hit
-- status='submitted' + stripe_payment_status='succeeded'. That's
-- payment time for PCH, not queue-ready time: the PCH queue itself
-- waits for the client's explicit "Submit for review" (which stamps
-- pch_cases.engine_snapshot_at), a separate write on a separate
-- table that this trigger never watched. Net effect: accountants got
-- a premature ping for a case they couldn't yet see or take, then
-- silence when the case actually became pickable.
--
-- Fix: exclude PCH from notify_case_change()'s became_queue branch,
-- and add a new trigger on pch_cases that fires the same
-- notification exactly when engine_snapshot_at transitions from
-- null to set (the real "it's in the queue now" moment). Personal
-- and Limited Company cases are untouched; they keep the
-- payment-time ping as before.
--
-- Applied live on 2026-10-21 via a hand-run statement (the Supabase
-- MCP tool's destructive-statement gate repeatedly cancelled
-- apply_migration for this change); this file brings the tracked
-- migration history back in sync with what's actually running in
-- production so a fresh environment or a db reset doesn't silently
-- regress back to the payment-time-only behavior.

create or replace function public.notify_case_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  became_queue boolean;
  status_changed boolean;
  queue_msg text;
  company_name text;
  status_msg text;
begin
  became_queue :=
    NEW.status = 'submitted'
    and NEW.stripe_payment_status = 'succeeded'
    and NEW.accountant_id is null
    and NEW.tier is distinct from 'uber_phv_automated'
    and (
      TG_OP = 'INSERT'
      or OLD.status is distinct from NEW.status
      or OLD.stripe_payment_status is distinct from NEW.stripe_payment_status
      or OLD.accountant_id is distinct from NEW.accountant_id
    );

  status_changed :=
    TG_OP = 'UPDATE' and OLD.status is distinct from NEW.status;

  if became_queue then
    queue_msg := case
      when coalesce(NEW.is_urgent, false) then 'New urgent case in the queue.'
      else 'New case in the queue.'
    end;
    insert into public.notifications (recipient_id, type, case_id, message)
    select ap.user_id, 'new_queue_case', NEW.id, queue_msg
      from public.accountant_profiles ap
     where ap.approval_status = 'approved';
  end if;

  if status_changed then
    company_name := nullif(trim(coalesce(NEW.intake_answers->>'company_name', '')), '');
    status_msg := case
      when company_name is not null then
        format('%s: moved to %s.', company_name,
               public.humanize_status(NEW.status::text))
      else
        format('Case moved to %s.', public.humanize_status(NEW.status::text))
    end;

    insert into public.notifications (recipient_id, type, case_id, message)
    values (NEW.client_id, 'case_status_change', NEW.id, status_msg);

    insert into public.notifications (recipient_id, type, case_id, message)
    select u.id, 'case_status_change', NEW.id, status_msg
      from public.users u where u.role = 'admin';

    if NEW.accountant_id is not null
       and OLD.status = 'client_approval'
       and NEW.status = 'filed' then
      insert into public.notifications (recipient_id, type, case_id, message)
      values (NEW.accountant_id, 'case_status_change', NEW.id,
              case
                when company_name is not null then
                  format('%s: client approved and filed. Time to mark complete.',
                         company_name)
                else
                  'Your client approved and filed. Time to mark complete.'
              end);
    end if;
  end if;

  return NEW;
end
$$;

create or replace function public.notify_pch_queue_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  queue_msg text;
begin
  if OLD.engine_snapshot_at is not null or NEW.engine_snapshot_at is null then
    return NEW;
  end if;

  select status, stripe_payment_status, accountant_id, is_urgent
    into c
    from public.cases
   where id = NEW.case_id;

  if c is null
     or c.status <> 'submitted'
     or c.stripe_payment_status <> 'succeeded'
     or c.accountant_id is not null then
    return NEW;
  end if;

  queue_msg := case
    when coalesce(c.is_urgent, false) then 'New urgent case in the queue.'
    else 'New case in the queue.'
  end;

  insert into public.notifications (recipient_id, type, case_id, message)
  select ap.user_id, 'new_queue_case', NEW.case_id, queue_msg
    from public.accountant_profiles ap
   where ap.approval_status = 'approved';

  return NEW;
end
$$;

drop trigger if exists pch_cases_notify_queue_ready on public.pch_cases;
create trigger pch_cases_notify_queue_ready
  after update on public.pch_cases
  for each row
  execute function public.notify_pch_queue_ready();
