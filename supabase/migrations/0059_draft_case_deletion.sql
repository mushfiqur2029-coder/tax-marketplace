-- New admin_action_type enum value so the audit log distinguishes
-- stale-draft-case deletion from the existing warning / suspend /
-- reinstate / approve / reject / admin_removed actions.
--
-- Paired with deleteStaleDraftCaseAction in src/app/admin/actions.ts
-- (primary-admin-only; same guard pattern as admin removal).

alter type admin_action_type add value if not exists 'draft_case_deleted';
