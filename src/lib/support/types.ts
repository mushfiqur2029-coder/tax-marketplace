// Plain type module for the support channel. Lives outside the
// "use server" actions file so pages + components can import these
// types without pulling the server-only action module into the
// client-side bundle resolver (lesson from the 7.6c hotfix: a
// "use server" module's exports must all be async functions, so types
// and sync helpers belong in sibling modules).

export type AttachmentRecord = {
  path: string;
  name: string;
  mime: string;
  size_bytes: number;
};

export type SupportMessageView = {
  id: string;
  authorRole: "client" | "accountant" | "admin";
  authorLabel: string;
  body: string;
  createdAt: string;
  attachments: AttachmentRecord[] | null;
  // Set on a message optimistically appended client-side right after our
  // own send, before any attachment has a real storage path to resolve a
  // download URL from. Never set on a message that came from the server.
  optimistic?: boolean;
};

export type SupportThreadView = {
  id: string;
  caseId: string;
  userId: string;
  userRole: "client" | "accountant";
  status: "open" | "resolved";
  assignedAdminId: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  messages: SupportMessageView[];
};

export type SupportThreadListItem = {
  id: string;
  caseId: string;
  caseShortId: string;    // first 8 chars of case uuid, for display
  userId: string;
  userRole: "client" | "accountant";
  userLabel: string;
  status: "open" | "resolved";
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  assignedAdminId: string | null;
  createdAt: string;
};
