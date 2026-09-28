-- notify_case_change: read is_urgent when broadcasting a new-queue-case
-- notification so accountants see "New urgent case in the queue." for
-- fast-tracked bookings. All other branches unchanged from 0016.

create or replace function public.notify_case_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  became_queue boolean;
  status_changed boolean;
  queue_msg text;
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
    insert into public.notifications (recipient_id, type, case_id, message)
    values (NEW.client_id, 'case_status_change', NEW.id,
            format('Case moved to %s.', public.humanize_status(NEW.status::text)));
    insert into public.notifications (recipient_id, type, case_id, message)
    select u.id, 'case_status_change', NEW.id,
           format('Case moved to %s.', public.humanize_status(NEW.status::text))
      from public.users u where u.role = 'admin';
    if NEW.accountant_id is not null
       and OLD.status = 'client_approval'
       and NEW.status = 'filed' then
      insert into public.notifications (recipient_id, type, case_id, message)
      values (NEW.accountant_id, 'case_status_change', NEW.id,
              'Your client approved and filed. Time to mark complete.');
    end if;
  end if;

  return NEW;
end $$;
