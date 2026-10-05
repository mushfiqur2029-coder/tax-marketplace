-- Fix the saveChecklistAnswersAction race condition properly, instead
-- of relying on the natural 100-300ms gap between a user's per-field
-- blur events to serialize concurrent read-merge-write cycles.
--
-- Previous shape (TypeScript):
--
--   const existing = caseRow.intake_answers ?? {};
--   const next = { ...existing, [field.id]: value };
--   await supabase.from("cases").update({ intake_answers: next });
--
-- Two parallel saves both read `existing` BEFORE either committed, so
-- the second write overwrote the first. Natural UX serialized it
-- most of the time; two rapid changes still raced.
--
-- New shape: a single SQL statement that reads + merges + writes
-- atomically. Postgres row-level locking + READ COMMITTED makes a
-- second UPDATE wait for the first, then re-evaluate its SET
-- expression against the committed state. No more lost writes.
--
-- The function runs as SECURITY INVOKER so the existing RLS policy
-- on public.cases (cases_client_update_own_draft, 0014's approve
-- policy, 0039's onboarding window) is the authoritative authz
-- gate — a client who can't UPDATE the row via REST also can't via
-- this RPC. Returns the row count so the TS caller can detect a
-- 0-rows RLS block and surface a loud error instead of a silent
-- "ok".

create or replace function public.merge_case_intake_answers(
  p_case_id uuid,
  p_patch jsonb
) returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rows int;
begin
  if p_patch is null or jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'p_patch must be a JSON object';
  end if;

  update public.cases
  set intake_answers = coalesce(intake_answers, '{}'::jsonb) || p_patch
  where id = p_case_id;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- authenticated role is the one PostgREST uses for signed-in users.
-- service_role bypasses, so no grant needed for it. Anon doesn't
-- need this.
grant execute on function public.merge_case_intake_answers(uuid, jsonb)
  to authenticated;
