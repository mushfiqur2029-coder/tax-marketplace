import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

// This host (apisterlingledger.co.uk) serves the portals + API only.
// Marketing content lives at sterlingledger.co.uk as static files.
// Hitting the bare `/` here always redirects:
//   • signed-in users -> /{role}  (their portal landing)
//   • everyone else   -> the marketing domain
// Nothing on this URL path should render content.
const MARKETING_HOME = "https://sterlingledger.co.uk/";

export default async function Root() {
  const me = await getCurrentUser();
  if (me) redirect(`/${me.role}`);
  redirect(MARKETING_HOME);
}
