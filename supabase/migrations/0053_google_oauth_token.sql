-- Single-row table storing the Google OAuth2 refresh token granted
-- by the calendar owner during the one-time admin consent flow at
-- /api/auth/google/connect. The refresh token lets our server mint
-- short-lived access tokens that act AS the owner — unlocking the two
-- things service-account auth can't do on a personal Gmail calendar:
--
--   1. attendees — Google sends the client a native calendar invite
--      with the Meet link, no custom email required.
--   2. conferenceData/hangoutsMeet — Meet links auto-attach to events.
--
-- Encryption mirrors the company_auth_code pattern (migration 0028):
-- pgp_sym_encrypt with a passphrase passed in from the app's
-- COMPANY_AUTH_CODE_KEY env on every call. Supabase's managed Postgres
-- doesn't log statement parameters at default log level, so the key
-- doesn't leak through pg_stat_statements or query logs.

create table if not exists public.google_oauth_token (
  id int primary key default 1,
  -- Hard single-row constraint. Multi-user OAuth (per-admin, per-
  -- accountant) can land later with its own schema if it's ever needed.
  constraint single_row check (id = 1),
  -- Which Google account the token was granted FROM. Lets us spot a
  -- mismatch if the owner switches accounts later.
  granted_to_email text not null,
  refresh_token_encrypted bytea not null,
  -- Captured on consent so we can detect if a scope upgrade is needed
  -- in a future deploy without a full re-consent.
  granted_scope text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id)
);

alter table public.google_oauth_token enable row level security;
-- Deliberately no SELECT/UPDATE/INSERT policies — every path goes
-- through the two SECURITY DEFINER RPCs below, called from server
-- code only via the service role.

-- -----------------------------------------------------------------
-- Write: upserts the single row, encrypting the refresh token.
-- -----------------------------------------------------------------
create or replace function public.set_google_refresh_token(
  p_email text,
  p_refresh_token text,
  p_scope text,
  p_key text,
  p_admin_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into public.google_oauth_token (
    id, granted_to_email, refresh_token_encrypted, granted_scope,
    updated_at, updated_by
  )
  values (
    1,
    p_email,
    pgp_sym_encrypt(p_refresh_token, p_key),
    p_scope,
    now(),
    p_admin_id
  )
  on conflict (id) do update set
    granted_to_email = excluded.granted_to_email,
    refresh_token_encrypted = excluded.refresh_token_encrypted,
    granted_scope = excluded.granted_scope,
    updated_at = now(),
    updated_by = excluded.updated_by;
end;
$$;

-- -----------------------------------------------------------------
-- Read: returns decrypted refresh token. One row shape so the Node
-- side can read via .rpc(...).data[0].
-- -----------------------------------------------------------------
create or replace function public.get_google_refresh_token(p_key text)
returns table (email text, refresh_token text, scope text)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
  select granted_to_email::text,
         pgp_sym_decrypt(refresh_token_encrypted, p_key)::text,
         granted_scope::text
  from public.google_oauth_token
  where id = 1;
end;
$$;
