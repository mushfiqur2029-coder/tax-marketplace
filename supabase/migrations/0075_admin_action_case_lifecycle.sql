-- 0075: proper admin_action_type enum values for two call sites that
-- were piggy-backing on the generic 'warning' value.
--
-- reassignCaseAction (src/app/admin/actions.ts) writes two admin_actions
-- rows per reassignment - one for the previous accountant, one for the
-- new one - both using action='warning' with the semantics encoded in
-- the note text. That made filter-by-action impossible: searching for
-- "warnings issued to accountant X" returned every reassignment they
-- had ever been on.
--
-- createBespokeCaseFromEnquiryAction (same file, bespoke flow) also used
-- 'warning' with a note like "Bespoke case <id> created at £X total...".
-- Same filter problem; also unhelpful for anyone browsing the audit log.
--
-- Adding two new enum values so each call site writes with its real
-- meaning:
--   case_reassigned      - admin moved a case between accountants
--                           (or unassigned to the queue). Written to
--                           both prev + new accountant's rows.
--   bespoke_case_created - admin accepted a bespoke enquiry and
--                           provisioned the case; target is the client.
--
-- No data migration: historical 'warning' rows stay as-is. The next
-- deploy flips the TS writers to the new values. If we ever want to
-- backfill, a hand-written UPDATE can rewrite rows whose note text
-- matches the known shapes.

alter type admin_action_type add value if not exists 'case_reassigned';
alter type admin_action_type add value if not exists 'bespoke_case_created';
