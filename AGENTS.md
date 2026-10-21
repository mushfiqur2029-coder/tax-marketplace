<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes. APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` ,  verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Standing rules

### No em or en dashes anywhere user-facing or in the shipping tree

Zero `U+2014` (em dash) or `U+2013` (en dash) in `src/`, `scripts/`, `supabase/`, `marketing-static-export/`, `AGENTS.md`, `README.md`, commit messages, or any shipped text. Use commas, periods, or "to" for ranges.

- Before every commit: `npm run check:dashes` (exits non-zero if any found).
- Auto-fix the current state: `node scripts/strip-dashes.mjs`. Note: this script's `EM`/`EN` constants are declared with `String.fromCodePoint` so running it on itself never corrupts the constants (the prior failure mode that broke `.slice(0, 10)` across the repo).

### UI must stay fully responsive, mobile-first

Every new page, component, and layout targets handheld widths first. The repo is heading toward native apps for all three roles (client, accountant, admin), so patterns must survive narrow viewports and touch interaction. Grid defaults: always include `grid-cols-1` as the base before any `md:`/`lg:` columns.
