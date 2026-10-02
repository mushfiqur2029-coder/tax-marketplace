-- Fix for 0028: Supabase installs pgcrypto into the `extensions` schema
-- by default, so a security-definer function with `set search_path =
-- public` can't resolve pgp_sym_encrypt / pgp_sym_decrypt.
--
-- Broadens the search_path on both RPCs to include `extensions`. We keep
-- `public` first because the function also reads from public.cases, and
-- Postgres search_path is left-to-right.
--
-- Function bodies are otherwise unchanged from 0028.

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

  if not (v_case.client_id = auth.uid() or public.is_admin()) then
    raise exception 'Not allowed.';
  end if;

  update public.cases
    set company_auth_code_encrypted = pgp_sym_encrypt(v_plain, p_key)
    where id = p_case_id;
end;
$$;

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
begin
  if nullif(trim(p_key), '') is null then
    raise exception 'Missing encryption key.';
  end if;

  select * into v_case from public.cases where id = p_case_id;
  if not found then
    raise exception 'Case not found.';
  end if;

  if not (public.is_admin() or v_case.accountant_id = auth.uid()) then
    raise exception 'Not allowed.';
  end if;

  if v_case.company_auth_code_encrypted is null then
    return null;
  end if;

  return pgp_sym_decrypt(v_case.company_auth_code_encrypted, p_key);
end;
$$;
