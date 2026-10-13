// Account-number masking helper, shared by the server component
// (admin/withdrawals/page.tsx) and the client component
// (reveal-bank-button.tsx). Must NOT carry a "use client" directive -
// the server component imports it synchronously at render time, and
// Next refuses to run a client-exported function on the server.
//
// Takes the full account number as stored (typically 8 digits for a
// UK bank account); returns a 4-dot prefix + the last 4 digits.
// Entries shorter than 5 chars pass through unchanged on the theory
// that there's nothing left to mask once we've dropped 4 chars.
export function maskAccountNumber(raw: string): string {
  const trimmed = raw.replace(/\s/g, "");
  if (trimmed.length <= 4) return trimmed;
  return "...." + trimmed.slice(-4);
}
