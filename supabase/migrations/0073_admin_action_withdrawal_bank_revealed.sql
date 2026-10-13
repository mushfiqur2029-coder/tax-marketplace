-- 0073: audit trail for admin-triggered reveals of a withdrawal
-- request's full bank account number.
--
-- Full plaintext bank details on withdrawal_requests sit on the
-- admin page today and are visible to every admin by default with
-- no record of who looked. Masking the account number to the last
-- 4 digits by default + requiring an explicit Reveal click + an
-- admin_actions row per reveal gives us "who saw this account
-- number, and when."
--
-- Reuses the existing admin_actions table (migration 0001) rather
-- than adding a new one, because the shape fits:
--   target_user_id = the accountant whose details were revealed
--   admin_id       = the admin who clicked Reveal
--   note           = withdrawal_request_id + request amount for grep
--
-- Only the enum value is new. The TS action in src/app/admin/actions.ts
-- (revealWithdrawalBankAction) owns the write.

alter type admin_action_type add value if not exists 'withdrawal_bank_revealed';
