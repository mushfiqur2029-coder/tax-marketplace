import { signOutAction } from "@/app/actions";
import { SLButton } from "@/components/sl-button";

// Mobile keeps the full 44px touch target (default .btn-sl sizing — ~44px
// tall from 11px vertical padding). Desktop (sm+) reverts to the compact
// 32px pill since the right header is less space-constrained there and
// Sign out is a secondary action.
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <SLButton
        type="submit"
        variant="outline"
        className="sm:!px-3 sm:!py-1.5 sm:!text-[13px]"
      >
        Sign out
      </SLButton>
    </form>
  );
}
