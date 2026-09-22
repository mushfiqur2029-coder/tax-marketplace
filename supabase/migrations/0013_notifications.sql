-- Batch B — notifications for all three roles.
--
-- Populated automatically by:
--   • DB triggers for messages + cases (high-fanout, multiple entry points)
--   • Server-action inserts for profile-change submissions + withdrawal
--     request/pay (single entry point each)
--
-- Realtime delivery is via Supabase Realtime (postgres_changes on the
-- notifications table filtered to recipient_id).

do $$ begin
  create type notification_type as enum (
    'new_queue_case',
    'new_message',
    'case_status_change',
    'profile_change_request',
    'withdrawal_requested',
    'withdrawal_paid'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.users(id) on delete cascade,
  type notification_type not null,
  case_id uuid references public.cases(id) on delete cascade,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc);
create index if not exists notifications_recipient_unread_idx
  on public.notifications (recipient_id, created_at desc)
  where read = false;

alter table public.notifications enable row level security;

-- Recipient can read + update their own rows only.
drop policy if exists "notifications_owner_read" on public.notifications;
create policy "notifications_owner_read" on public.notifications
  for select using (recipient_id = auth.uid());

drop policy if exists "notifications_owner_update" on public.notifications;
create policy "notifications_owner_update" on public.notifications
  for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- Inserts happen through service_role (triggers run as security-definer,
-- server actions use the admin client). No client-side inserts needed.

-- Realtime publication.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end $$;
alter table public.notifications replica identity full;

-- ==========================================================================
-- Helper: humanize a case status for message copy.
-- ==========================================================================
create or replace function public.humanize_status(s text) returns text
language sql immutable as $$
  select case s
    when 'draft' then 'Draft'
    when 'submitted' then 'Submitted'
    when 'in_review' then 'In review'
    when 'prepared' then 'Prepared'
    when 'client_approval' then 'Awaiting your approval'
    when 'filed' then 'Filed'
    when 'complete' then 'Complete'
    else s
  end;
$$;

-- ==========================================================================
-- Trigger: notify on new message in any channel.
--
-- Rules per spec:
--   client_accountant: sender=client → notify accountant;
--                      sender=accountant → notify client
--   client_admin:      sender=client → notify all admins;
--                      sender=admin  → notify client
--   accountant_admin:  sender=accountant → notify all admins;
--                      sender=admin      → notify accountant
-- ==========================================================================
create or replace function public.notify_new_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_case public.cases%rowtype;
begin
  select * into v_case from public.cases where id = NEW.case_id;
  if not found then return NEW; end if;

  if NEW.channel = 'client_accountant' then
    if NEW.sender_id = v_case.client_id and v_case.accountant_id is not null then
      insert into public.notifications (recipient_id, type, case_id, message)
      values (v_case.accountant_id, 'new_message', NEW.case_id,
              'New message from your client.');
    elsif NEW.sender_id = v_case.accountant_id then
      insert into public.notifications (recipient_id, type, case_id, message)
      values (v_case.client_id, 'new_message', NEW.case_id,
              'New message from your accountant.');
    end if;

  elsif NEW.channel = 'client_admin' then
    if NEW.sender_id = v_case.client_id then
      insert into public.notifications (recipient_id, type, case_id, message)
      select u.id, 'new_message', NEW.case_id, 'New client support message.'
        from public.users u where u.role = 'admin';
    else
      insert into public.notifications (recipient_id, type, case_id, message)
      values (v_case.client_id, 'new_message', NEW.case_id,
              'New reply from Sterling Ledger.');
    end if;

  elsif NEW.channel = 'accountant_admin' then
    if NEW.sender_id = v_case.accountant_id then
      insert into public.notifications (recipient_id, type, case_id, message)
      select u.id, 'new_message', NEW.case_id, 'New accountant support message.'
        from public.users u where u.role = 'admin';
    elsif v_case.accountant_id is not null then
      insert into public.notifications (recipient_id, type, case_id, message)
      values (v_case.accountant_id, 'new_message', NEW.case_id,
              'New reply from Sterling Ledger.');
    end if;
  end if;

  return NEW;
end $$;

drop trigger if exists messages_notify on public.messages;
create trigger messages_notify after insert on public.messages
for each row execute function public.notify_new_message();

-- ==========================================================================
-- Trigger: cases table
--
-- Fires for two overlapping events:
--   (a) A case "enters the queue" (paid, submitted, unassigned) — broadcast
--       'new_queue_case' to every approved accountant.
--   (b) A case's status changes on UPDATE — notify client + admins.
--
-- Note: (a) intentionally does NOT also emit a case_status_change — the
-- accountants get one queue ping per case, which is what they want.
-- ==========================================================================
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
            format('Case moved to %s.', public.humanize_status(NEW.status)));
    -- Admins
    insert into public.notifications (recipient_id, type, case_id, message)
    select u.id, 'case_status_change', NEW.id,
           format('Case moved to %s.', public.humanize_status(NEW.status))
      from public.users u where u.role = 'admin';
  end if;

  return NEW;
end $$;

drop trigger if exists cases_notify on public.cases;
create trigger cases_notify after insert or update on public.cases
for each row execute function public.notify_case_change();
