-- Hotfix: admin needs to be able to reply on ANY channel (including the direct
-- client↔accountant thread), matching the brief's "read and reply" wording.

drop policy if exists "messages_insert_channel_parties" on public.messages;
create policy "messages_insert_channel_parties" on public.messages
  for insert with check (
    sender_id = auth.uid()
    and (
      public.is_admin()
      or exists (
        select 1 from public.cases c
        where c.id = case_id and (
          (channel = 'client_accountant'
             and (c.client_id = auth.uid() or c.accountant_id = auth.uid()))
          or (channel = 'client_admin'
             and c.client_id = auth.uid())
          or (channel = 'accountant_admin'
             and c.accountant_id = auth.uid())
        )
      )
    )
  );
