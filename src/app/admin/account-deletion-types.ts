// Type exports for the account-deletion pre-check. Lives outside the
// "use server" action module because that module only permits async
// function exports — any `export type` there makes Next's compiler
// reject the whole file ("The module has no exports at all"), which
// cascades into import errors on every page that reads the action
// module.

export type ClientDeletionCheck = {
  blocked: boolean;
  blockReason: string | null;
  paidCases: number;
  draftCases: number;
  totalCases: number;
  documents: number;
  bookings: number;
  enquiries: number;
};

export type AccountantDeletionCheck = {
  blocked: boolean;
  blockReason: string | null;
  walletTransactions: number;
  walletBalancePence: number;
  withdrawalRequests: number;
  addonsIssued: number;
  vatCyclesCreated: number;
  documentsUploaded: number;
  assignedLiveCases: number;
};
