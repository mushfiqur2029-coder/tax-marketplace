// Shared constants used by both the admin server actions and the
// admin page components. Lives outside the "use server" action
// module because that module only permits async function exports —
// any `export const` there makes Turbopack reject the whole file
// ("The module has no exports at all"), which cascades into import
// errors on every page that reads from the action module.

// Age threshold for the stale-draft-case deletion flow. Mirrored
// server-side (eligibility check in deleteStaleDraftCaseAction) and
// client-side (filter query + display label on /admin). One constant
// keeps them in lockstep.
export const STALE_DRAFT_DAYS = 3;
