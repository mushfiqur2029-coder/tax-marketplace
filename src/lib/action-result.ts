// Shared shape for server-action mutations.
//
// Server actions that throw are digested by Next.js in production, and the
// user sees an opaque "React error #NNN" instead of anything actionable.
// Actions that catch their own errors and return this shape keep the real
// message intact — the caller reads res.error and renders it.
//
// Use fail() in the catch block; it re-throws Next.js redirect/notFound
// signals so navigation still happens on the success path.
// T defaults to void when the action just mutates. Data-returning actions
// use ActionResult<CreatedRow> etc.
export type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

// Next.js signals redirects and 404s by throwing an Error with a specific
// digest prefix. Catching those in try/catch and returning {ok:false} would
// swallow the redirect — this helper detects them so the outer catch can
// re-throw before wrapping anything else.
function isNextControlFlow(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const digest = (e as { digest?: unknown }).digest;
  if (typeof digest !== "string") return false;
  return digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND";
}

export function fail(
  e: unknown,
  fallback = "Something went wrong.",
): { ok: false; error: string } {
  if (isNextControlFlow(e)) throw e;
  return {
    ok: false,
    error: e instanceof Error ? e.message : fallback,
  };
}
