-- Fill in the gaps in the accountant's notification coverage.
--
-- Existing coverage (already working):
--   • new_queue_case: broadcast when a paid case enters the queue
--   • new_message: fired by the messages trigger (client / admin -> accountant)
--   • withdrawal_paid: inline in markWithdrawalPaidAction
--
-- Missing coverage this migration adds:
--   • Client approves and files — a status transition the accountant did NOT
--     initiate. Extends notify_case_change to also notify the accountant
--     on the specific client_approval -> filed transition.
--   • Reassignment (admin moves case to / from an accountant): handled
--     inline in reassignCaseAction (the server action knows both old + new
--     accountant_id explicitly). Needs a new notification_type value.
--   • Approval decision (admin approves / rejects an accountant): handled
--     inline in setAccountantApprovalAction. Needs a new notification_type
--     value.
--
-- The no-self-noise rule stays: the accountant is NOT notified when they
-- personally advance a case (submitted -> in_review -> prepared ->
-- client_approval, or filed -> complete). Those transitions are skipped by
-- the new trigger branch; only the client's approve-and-file lands in
-- the accountant's bell.

alter type notification_type add value if not exists 'case_reassigned';
alter type notification_type add value if not exists 'accountant_approval_decision';

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
    -- Accountant: only for transitions they did NOT initiate. The client's
    -- approve-and-file (client_approval -> filed) is the one such
    -- transition; every other advance is accountant-driven.
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
