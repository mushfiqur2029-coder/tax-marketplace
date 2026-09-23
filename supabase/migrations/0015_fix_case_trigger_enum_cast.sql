-- Fix: notify_case_change trigger fails on every case status update with
--   42883: function public.humanize_status(case_status) does not exist
--
-- Root cause: humanize_status was declared humanize_status(text) but the
-- trigger passes NEW.status which is of enum type case_status. PostgreSQL
-- does not implicitly cast an enum to text when resolving function calls
-- (comparisons to string literals work, function argument resolution does
-- not), so the entire UPDATE aborts before the status change lands.
--
-- Two blast-radius bugs it caused:
--   • Accountant "Mark as prepared" (and any status advance) failed
--   • Client "Approve and file" (client_approval -> filed) failed
--
-- Fix: cast NEW.status to text explicitly at the two trigger call sites.
-- Everything else in the trigger is unchanged.

create or replace function public.notify_case_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  became_queue boolean;
  status_changed boolean;
begin
  became_queue :=
    NEW.status = 'submitted'
    and NEW.stripe_payment_status = 'succeeded'
    and NEW.accountant_id is null
    and (
      TG_OP = 'INSERT'
      or OLD.status is distinct from NEW.status
      or OLD.stripe_payment_status is distinct from NEW.stripe_payment_status
      or OLD.accountant_id is distinct from NEW.accountant_id
    );

  status_changed :=
    TG_OP = 'UPDATE' and OLD.status is distinct from NEW.status;

  if became_queue then
    insert into public.notifications (recipient_id, type, case_id, message)
    select ap.user_id, 'new_queue_case', NEW.id, 'New case in the queue.'
      from public.accountant_profiles ap
     where ap.approval_status = 'approved';
  end if;

  if status_changed then
    -- Client
    insert into public.notifications (recipient_id, type, case_id, message)
    values (NEW.client_id, 'case_status_change', NEW.id,
            format('Case moved to %s.', public.humanize_status(NEW.status::text)));
    -- Admins
    insert into public.notifications (recipient_id, type, case_id, message)
    select u.id, 'case_status_change', NEW.id,
           format('Case moved to %s.', public.humanize_status(NEW.status::text))
      from public.users u where u.role = 'admin';
  end if;

  return NEW;
end $$;
