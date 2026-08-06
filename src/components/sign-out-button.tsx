import { signOutAction } from "@/app/actions";
import { SLButton } from "@/components/sl-button";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <SLButton type="submit" variant="outline" className="!px-3 !py-1.5 !text-[13px]">
        Sign out
      </SLButton>
    </form>
  );
}
