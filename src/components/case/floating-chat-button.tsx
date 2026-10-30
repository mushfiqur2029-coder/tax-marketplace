"use client";

/**
 * Fixed-position shortcut to the chat panel, shown only below `xl`
 * (C4/A6 in the UX scoping report). On the client and accountant case
 * detail pages the chat panel sits in a second grid column that only
 * appears side-by-side at `xl:`; below that, the layout stacks to a
 * single column and chat (the primary interaction surface, per the
 * report) ends up at the bottom of a long page. Rather than restructure
 * the grid or lift chat's internal unread state out to badge this
 * button, this gives an always-reachable jump link straight to the
 * chat panel's anchor, which solves the stated problem (chat is hard to
 * reach without scrolling the whole page) with no risk to the chat
 * component itself.
 *
 * Usage: give the chat panel's wrapping element id="case-chat" and
 * `scroll-mt-20` (or similar, enough to clear any sticky header) so the
 * browser's native anchor scroll lands with room to spare, then render
 * this once anywhere on the page.
 */
export function FloatingChatButton() {
  return (
    <a
      href="#case-chat"
      className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full shadow-2xl xl:hidden"
      style={{
        background: "linear-gradient(135deg, var(--navy) 0%, var(--sky) 100%)",
        boxShadow: "0 14px 30px -10px rgba(25,156,217,0.55)",
      }}
      aria-label="Jump to chat"
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    </a>
  );
}
