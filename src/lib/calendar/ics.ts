// Minimal RFC 5545 generator for the booking confirmation email
// attachment. One VEVENT per call, no recurrence, no attendees list
// (the native Google invite covers attendee invites; this is only the
// backup "add to your own calendar" artefact).
//
// Deliberately NOT using a library — the format is dead simple and
// pulling in `ics` or `node-ical` adds surface area for one function.

export type IcsInput = {
  // Globally unique id. Reuse the Google event id when available so
  // if the client ever re-imports the ics, their calendar matches.
  uid: string;
  // Short title shown in the client's calendar.
  summary: string;
  // Optional multi-line description. Line endings normalised below.
  description?: string;
  // Start / end in whatever Date the server produced them; the ics
  // output is always UTC (Z-suffixed).
  startIso: string;
  endIso: string;
  // Optional URL — attached as the event's URL property so the
  // client's calendar can link back (we point this at the Google
  // Meet link when it exists).
  url?: string;
  // Optional location — used for the Meet URL in human-facing
  // calendars that show LOCATION prominently (eg Apple Calendar).
  location?: string;
};

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

// YYYYMMDDTHHMMSSZ — the only timestamp format iCal reliably parses.
function fmtUtc(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const mo = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mm = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${y}${mo}${dd}T${hh}${mm}${ss}Z`;
}

// RFC 5545 escapes: backslash → \\, comma → \,, semicolon → \;,
// newlines → \n (literal, two chars).
function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

// Long lines must be folded at 75 octets with CRLF + space. Keeps
// parsers in Outlook / Apple Mail happy.
function fold(line: string): string {
  if (line.length <= 73) return line;
  const chunks: string[] = [];
  let i = 0;
  while (i < line.length) {
    chunks.push((i === 0 ? "" : " ") + line.slice(i, i + (i === 0 ? 73 : 72)));
    i += i === 0 ? 73 : 72;
  }
  return chunks.join("\r\n");
}

export function buildIcs(input: IcsInput): string {
  const now = fmtUtc(new Date().toISOString());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sterling Ledger//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeText(input.uid)}`,
    `DTSTAMP:${now}`,
    `DTSTART:${fmtUtc(input.startIso)}`,
    `DTEND:${fmtUtc(input.endIso)}`,
    `SUMMARY:${escapeText(input.summary)}`,
  ];
  if (input.description) {
    lines.push(`DESCRIPTION:${escapeText(input.description)}`);
  }
  if (input.location) {
    lines.push(`LOCATION:${escapeText(input.location)}`);
  }
  if (input.url) {
    lines.push(`URL:${escapeText(input.url)}`);
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

// Base64 encoding for the Apps Script email endpoint, which takes
// attachment bytes as base64 strings.
export function buildIcsBase64(input: IcsInput): string {
  return Buffer.from(buildIcs(input), "utf-8").toString("base64");
}
