// Client-safe helpers for the Phase 6 doc checklist.
//
// Phase 6 Slice 7 removed per-slot AI interviews (PCH-01/02/03 are
// deprecated; income capture now runs off the bank-statement upload
// pipeline). The only "I don't have this document" fallback left is
// the accountant-help request flow, available on every active slot
// EXCEPT the one the Phase 6 scope marks as a mandatory upload.
//
//   PCH-14 bank statements, mandatory: the bookkeeping pipeline needs
//          at least one statement; there is no alternative path.
//
// PCH-23 (signed approval) was retired by migration 0098; sign-off now
// runs through the Slice 7 final-pack confirm button in-app, so there
// is no upload slot to make mandatory.
export const MANDATORY_UPLOAD_SLOTS = ["PCH-14"] as const;

export function canRequestAlternative(slotCode: string): boolean {
  return !(MANDATORY_UPLOAD_SLOTS as readonly string[]).includes(slotCode);
}

// Phase 7 Slice 7.6c: vehicle statuses that put the car into the
// capital-allowances pool (and therefore surface a disposal question).
// Leased / Rented / No vehicle cases don't carry a pool, so the
// VEHICLE_CA_EXT disposal sub-panel never shows for them. Kept in sync
// with compute.ts's caEligible set.
//
// Client-safe: this module is imported from React Client Components,
// so it must not sit in a "use server" file. Previously lived in
// vehicle-interview-actions.ts; moved here when the production bundler
// (correctly) refused a sync export from a "use server" module.
const CA_ELIGIBLE_STATUSES = new Set(["Owned outright", "Hire purchase", "PCP", "Loan"]);

export function isCaEligibleStatus(status: string | null | undefined): boolean {
  return status != null && CA_ELIGIBLE_STATUSES.has(status.trim());
}
