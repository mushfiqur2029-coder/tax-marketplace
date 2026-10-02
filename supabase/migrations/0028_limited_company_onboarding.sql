-- Limited-company post-payment onboarding checklist.
--
-- Flow:
--   paid → client fills Sections A/B/C (+ D for vat_reg) → submit
--   → onboarding_submitted_at stamped → case becomes visible in the
--   accountant queue
--
-- Status machine is deliberately unchanged. The case stays at
-- status='submitted' + stripe_payment_status='succeeded' after payment
-- as before; the queue filter grows one condition for the limited-
-- company path so the case stays invisible until onboarding completes.
--
-- Encryption:
--   company_auth_code is a live Companies House credential (anyone with
--   it can change the client's company). It never lives in plaintext in
--   the row. pgcrypto's pgp_sym_encrypt stores it as bytea; a passphrase
--   lives in the app's COMPANY_AUTH_CODE_KEY env and is passed to the
--   RPC on every encrypt/decrypt call. Supabase's managed Postgres does
--   not log statement parameters under default logging, so the
--   passphrase does not reach the log stream.

create extension if not exists pgcrypto with schema public;

alter table public.cases
  add column if not exists onboarding_submitted_at timestamptz,
  add column if not exists company_auth_code_encrypted bytea;

-- Uploads tagged with which checklist slot they fill. Null for existing
-- personal-flow uploads (they don't fit a per-key checklist). Multiple
-- uploads can share a key (e.g. multiple HMRC letters).
alter table public.case_documents
  add column if not exists requirement_key text;

create index if not exists case_documents_case_requirement_idx
  on public.case_documents(case_id, requirement_key);

-- ==========================================================================
-- RPC: set_company_auth_code
-- Encrypt + write. Auth: case client or admin. Rejects empty plaintext so
-- an accidental blank submit doesn't clear a previously-set code.
-- ==========================================================================

create or replace function public.set_company_auth_code(
  p_case_id uuid,
  p_plain text,
  p_key text
) returns void
language plpgsql
security definer
set search_path = public
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

-- ==========================================================================
-- RPC: get_company_auth_code
-- Decrypt + return plaintext. Auth: admin or the case's assigned
-- accountant. The client themselves do NOT need to read it back — they
-- supplied it. Returns null if never set, lets caller distinguish empty
-- from set-but-wrong-key via the error path.
-- ==========================================================================

create or replace function public.get_company_auth_code(
  p_case_id uuid,
  p_key text
) returns text
language plpgsql
security definer
set search_path = public
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
