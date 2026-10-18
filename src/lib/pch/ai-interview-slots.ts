// Client-safe list of PCH slot codes that have an AI interview flow.
//
// The actual flows live in server-only ai-interview.ts (which imports
// the Anthropic SDK). The client workspace only needs to know whether
// to show the "I don't have this document" button on a given slot, so
// we duplicate the key list here and keep the two in sync by hand.
// Adding a new slot to INTERVIEW_FLOWS (ai-interview.ts) also means
// adding it here.

export const INTERVIEW_ENABLED_SLOTS = ["PCH-01", "PCH-02", "PCH-03"] as const;

export type InterviewEnabledSlot = (typeof INTERVIEW_ENABLED_SLOTS)[number];

export function hasInterviewFor(slotCode: string): boolean {
  return (INTERVIEW_ENABLED_SLOTS as readonly string[]).includes(slotCode);
}

// Slots where "I don't have this document" is NOT offered at all.
// Everything else gets either the AI interview (if INTERVIEW_ENABLED)
// or the accountant-help fallback (Slice 5).
//
//   PCH-14 bank statements, excluded by the Phase 5 scope: still
//          required from the client, period.
//   PCH-23 signed approval, the client's own signature; there is no
//          alternative path, that's the sign-off step itself.
export const MANDATORY_UPLOAD_SLOTS = ["PCH-14", "PCH-23"] as const;

export function canRequestAlternative(slotCode: string): boolean {
  return !(MANDATORY_UPLOAD_SLOTS as readonly string[]).includes(slotCode);
}
