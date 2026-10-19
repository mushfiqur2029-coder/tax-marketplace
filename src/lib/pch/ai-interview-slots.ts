// Client-safe helpers for the Phase 6 doc checklist.
//
// Phase 6 Slice 7 removed per-slot AI interviews (PCH-01/02/03 are
// deprecated; income capture now runs off the bank-statement upload
// pipeline). The only "I don't have this document" fallback left is
// the accountant-help request flow, available on every active slot
// EXCEPT the two the Phase 6 scope marks as mandatory uploads.
//
//   PCH-14 bank statements, mandatory: the bookkeeping pipeline needs
//          at least one statement; there is no alternative path.
//   PCH-23 signed approval, the client's own signature; there is no
//          alternative path, that's the sign-off step itself.
export const MANDATORY_UPLOAD_SLOTS = ["PCH-14", "PCH-23"] as const;

export function canRequestAlternative(slotCode: string): boolean {
  return !(MANDATORY_UPLOAD_SLOTS as readonly string[]).includes(slotCode);
}
