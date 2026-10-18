-- 0090: Light up the bell on new case_messages inserts.
--
-- The 0089 schema introduced case_messages but relied on a background
-- email as the only cross-party nudge. The notifications table + bell
-- UI already handle 'new_message'; this trigger just mirrors the
-- existing messages-table pattern (see 0013) for the new table.
--
-- Routing:
--   client author     -> notify the case's accountant
--   accountant author -> notify the case's client
--   admin author      -> notify both the client and the accountant
--                        (admin steps in rarely; both parties should see it)
--
-- Everything is best-effort. A notification insert must not roll back
-- the message write. We don't catch exceptions in-trigger because the
-- underlying inserts are simple and failures here are a real bug worth
-- surfacing, matching 0013's behaviour.

create or replace function public.notify_new_case_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_case public.cases%rowtype;
begin
  select * into v_case from public.cases where id = NEW.case_id;
  if not found then return NEW; end if;

  if NEW.author_role = 'client' then
    if v_case.accountant_id is not null then
      insert into public.notifications (recipient_id, type, case_id, message)
      values (v_case.accountant_id, 'new_message', NEW.case_id,
              'New message from your client.');
    end if;

  elsif NEW.author_role = 'accountant' then
    insert into public.notifications (recipient_id, type, case_id, message)
    values (v_case.client_id, 'new_message', NEW.case_id,
            'New message from your accountant.');

  elsif NEW.author_role = 'admin' then
    insert into public.notifications (recipient_id, type, case_id, message)
    values (v_case.client_id, 'new_message', NEW.case_id,
            'New message from Sterling Ledger.');
    if v_case.accountant_id is not null then
      insert into public.notifications (recipient_id, type, case_id, message)
      values (v_case.accountant_id, 'new_message', NEW.case_id,
              'New message from Sterling Ledger.');
    end if;
  end if;

  return NEW;
end $$;

drop trigger if exists case_messages_notify on public.case_messages;
create trigger case_messages_notify after insert on public.case_messages
for each row execute function public.notify_new_case_message();
