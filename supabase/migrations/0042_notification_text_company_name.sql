-- notify_case_change: prefix the status-change notification body with
-- the company name on limited-company cases, when we have one.
--
-- Reads intake_answers->>'company_name' on NEW (the new row). Shape:
--   "<Company> — moved to <status>."    when company_name is present
--   "Case moved to <status>."           fallback (personal-tax cases
--                                       and legacy LC cases that
--                                       signed before capture landed)
--
-- Other branches (new_queue_case, client-approval-to-filed accountant
-- nudge) unchanged. The queue notification already carries case_id so
-- the accountant can click through — personalising its text would
-- require joining accountant_profiles against cases on every insert
-- which isn't worth it for a line of UI.

create or replace function public.notify_case_change() returns trigger
language plpgsql security definer set search_path = public as $$
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
    -- Build the status line once, re-use for client + admin fan-out.
    -- nullif turns the empty-string case (which jsonb -> text yields
    -- for a missing key when wrapped in trim) into a null so the
    -- coalesce chooses the fallback.
    company_name := nullif(trim(coalesce(NEW.intake_answers->>'company_name', '')), '');
    status_msg := case
      when company_name is not null then
        format('%s — moved to %s.', company_name,
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
                  format('%s — client approved and filed. Time to mark complete.',
                         company_name)
                else
                  'Your client approved and filed. Time to mark complete.'
              end);
    end if;
  end if;

  return NEW;
end $$;
