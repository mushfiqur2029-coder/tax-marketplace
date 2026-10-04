-- Batch 5 fix: lock down which columns a client can touch on
-- vat_return_cycles.
--
-- V7a of the Batch 5 E2E caught: the "vat_cycles_client_update_own"
-- policy from 0034 permits UPDATE on any column, so a crafted REST
-- call from a client's JWT could overwrite approval_payload, cycle
-- dates, or period_label — all accountant-owned fields. The server
-- actions only ever write status/client_docs_submitted_at/filed_at
-- for client paths, but DB-level enforcement is what makes it a real
-- security gate (not just a TS code path).
--
-- Fix: a BEFORE UPDATE trigger that only fires when auth.uid() equals
-- the case's client_id. Accountants, admins, and service_role writes
-- early-return and are unaffected. Allowed client transitions mirror
-- the two server actions:
--
--   submitVatCycleDocsAction       : awaiting_client_docs → in_review,
--                                    stamps client_docs_submitted_at
--   approveAndFileVatCycleAction   : client_approval      → filed,
--                                    stamps filed_at

create or replace function public.enforce_vat_cycle_client_updates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client uuid;
begin
  select client_id into v_client from public.cases where id = NEW.case_id;

  -- Not a client write — accountant / admin / service_role flows skip
  -- this guard. Null auth.uid() (service role via admin client) also
  -- skips, which is intentional: the admin client is a trusted
  -- continuation (used by approveAndFileVatCycleAction for the
  -- auto-next-cycle insert; UPDATE paths from the admin client are
  -- test-only).
  if auth.uid() is null or auth.uid() is distinct from v_client then
    return NEW;
  end if;

  -- Accountant-owned columns must not change on a client write.
  if NEW.case_id        is distinct from OLD.case_id
     or NEW.cycle_number    is distinct from OLD.cycle_number
     or NEW.period_label    is distinct from OLD.period_label
     or NEW.cycle_start_date is distinct from OLD.cycle_start_date
     or NEW.cycle_end_date   is distinct from OLD.cycle_end_date
     or NEW.approval_payload is distinct from OLD.approval_payload
     or NEW.created_at       is distinct from OLD.created_at
     or NEW.created_by       is distinct from OLD.created_by then
    raise exception 'Clients can only transition status and stamp their own timestamp columns.';
  end if;

  if NEW.status is distinct from OLD.status then
    if not (
      (OLD.status = 'awaiting_client_docs' and NEW.status = 'in_review')
      or (OLD.status = 'client_approval' and NEW.status = 'filed')
    ) then
      raise exception 'Client cannot transition cycle from % to %.', OLD.status, NEW.status;
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists enforce_vat_cycle_client_updates_tr on public.vat_return_cycles;
create trigger enforce_vat_cycle_client_updates_tr
  before update on public.vat_return_cycles
  for each row execute function public.enforce_vat_cycle_client_updates();
