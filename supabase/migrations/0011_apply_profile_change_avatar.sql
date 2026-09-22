-- Extend apply_profile_change to sync avatar_path onto the target profile row.
-- Previously the RPC copied name / contact_number / address / company_* only,
-- so an approved avatar change silently no-op'd. The avatar_path columns
-- themselves have existed since migration 0007.

create or replace function public.apply_profile_change(
  p_change_id uuid,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pending_profile_changes%rowtype;
  v_proposed jsonb;
begin
  if not public.is_admin() then raise exception 'not admin'; end if;

  select * into v_row
    from public.pending_profile_changes
   where id = p_change_id and status = 'pending';
  if not found then raise exception 'change not pending'; end if;

  v_proposed := v_row.proposed;

  if v_row.role = 'client' then
    update public.client_profiles
       set name           = coalesce(nullif(v_proposed->>'name',           ''), name),
           contact_number = coalesce(nullif(v_proposed->>'contact_number', ''), contact_number),
           address        = coalesce(nullif(v_proposed->>'address',        ''), address),
           avatar_path    = coalesce(nullif(v_proposed->>'avatar_path',    ''), avatar_path)
     where user_id = v_row.user_id;
  elsif v_row.role = 'accountant' then
    update public.accountant_profiles
       set name           = coalesce(nullif(v_proposed->>'name',           ''), name),
           contact_number = coalesce(nullif(v_proposed->>'contact_number', ''), contact_number),
           company_name   = coalesce(nullif(v_proposed->>'company_name',   ''), company_name),
           company_email  = coalesce(nullif(v_proposed->>'company_email',  ''), company_email),
           avatar_path    = coalesce(nullif(v_proposed->>'avatar_path',    ''), avatar_path)
     where user_id = v_row.user_id;
  end if;

  if (v_proposed->>'email') is not null and (v_proposed->>'email') <> '' then
    update public.users
       set email = v_proposed->>'email'
     where id = v_row.user_id;
  end if;

  update public.pending_profile_changes
     set status = 'approved',
         reviewed_at = now(),
         reviewed_by = auth.uid(),
         review_note = p_note
   where id = p_change_id;
end;
$$;
