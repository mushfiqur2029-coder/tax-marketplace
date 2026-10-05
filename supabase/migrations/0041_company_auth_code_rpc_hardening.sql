-- Fix the "Reveal authentication code shows Not allowed. for the
-- assigned accountant" bug plus the mirror defense-in-depth gap in
-- the sibling set RPC.
--
-- Root cause of the live bug:
--   revealCompanyAuthCodeAction calls admin.rpc("get_company_auth_code",
--   ...) — the service-role client. Inside the RPC, auth.uid() is NULL.
--   0030 made the assigned-accountant check null-safe with coalesce, so
--   with auth.uid()=null the function correctly rejects (as it would for
--   any truly unauthenticated caller). Fix is at the call site: switch
--   to the user-session supabase client so auth.uid() reflects the
--   actual accountant.
--
-- Mirror gap in set_company_auth_code (NOT a live bug but worth closing):
--   The authz is
--     if not (v_case.client_id = auth.uid() or public.is_admin()) then
--       raise exception 'Not allowed.';
--   With auth.uid()=null:
--     v_case.client_id = NULL      → NULL (three-valued)
--     is_admin()                   → false
--     NULL or false                → NULL
--     not NULL                     → NULL
--     if NULL then raise           → not raised
--   So any null-auth caller (service role) silently bypasses the authz
--   and the UPDATE proceeds. That's working by accident today because
--   saveChecklistAnswersAction calls it via admin.rpc. Hardened the
--   same way 0030 hardened get: explicit "is not null" guard +
--   coalesce.
--
-- Also grant EXECUTE to the `authenticated` role on both so the user-
-- session supabase client can actually invoke them. Previously only
-- the service role could reach them.

create or replace function public.set_company_auth_code(
  p_case_id uuid,
  p_plain text,
  p_key text
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_case public.cases%rowtype;
  v_plain text := nullif(trim(p_plain), '');
  v_is_owner boolean;
begin
  if v_plain is null then
    raise exception 'Company Authentication Code cannot be empty.';
  end if;
  if nullif(trim(p_key), '') is null then
    raise exception 'Missing encryption key.';
  end if;

  select * into v_case from public.cases where id = p_case_id;
  if not found then
    raise exception 'Case not found.';
  end if;

  v_is_owner :=
    auth.uid() is not null
    and coalesce(v_case.client_id = auth.uid(), false);

  if not (v_is_owner or public.is_admin()) then
    raise exception 'Not allowed.';
  end if;

  update public.cases
    set company_auth_code_encrypted = pgp_sym_encrypt(v_plain, p_key)
    where id = p_case_id;
end;
$$;

grant execute on function public.set_company_auth_code(uuid, text, text)
  to authenticated;
grant execute on function public.get_company_auth_code(uuid, text)
  to authenticated;
