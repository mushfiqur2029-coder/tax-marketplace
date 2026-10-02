-- Security fix for 0028 / 0029: get_company_auth_code's authz check used
--   v_case.accountant_id = auth.uid()
-- which evaluates to NULL (not false) when accountant_id is null. The
-- outer `if not (admin or assigned) then raise` then became
-- `if not (false or null)` → `if not null` → `if null`, which does NOT
-- execute the then-branch. The function returned the plaintext.
--
-- Impact pre-fix: any authenticated user (including the client
-- themselves, or any approved accountant) could decrypt the Company
-- Authentication Code on any case that didn't yet have an accountant
-- assigned. Caught during Batch 3's DB/API roundtrip test.
--
-- Fix: coalesce the equality to false so three-valued logic can't bypass
-- the check. Belt-and-braces: also add an explicit "not null" check
-- before the comparison, so a future refactor that drops the coalesce
-- doesn't silently reintroduce the bug.
--
-- The sibling set_company_auth_code is NOT vulnerable because
-- v_case.client_id is NOT NULL in the schema, so its comparison can
-- never evaluate to NULL. Left unchanged.

create or replace function public.get_company_auth_code(
  p_case_id uuid,
  p_key text
) returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_case public.cases%rowtype;
  v_is_assigned boolean;
begin
  if nullif(trim(p_key), '') is null then
    raise exception 'Missing encryption key.';
  end if;

  select * into v_case from public.cases where id = p_case_id;
  if not found then
    raise exception 'Case not found.';
  end if;

  v_is_assigned :=
    v_case.accountant_id is not null
    and coalesce(v_case.accountant_id = auth.uid(), false);

  if not (public.is_admin() or v_is_assigned) then
    raise exception 'Not allowed.';
  end if;

  if v_case.company_auth_code_encrypted is null then
    return null;
  end if;

  return pgp_sym_decrypt(v_case.company_auth_code_encrypted, p_key);
end;
$$;
