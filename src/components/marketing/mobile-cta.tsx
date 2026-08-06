import { SLLink } from "@/components/sl-button";

export function MobileCta() {
  return (
    <div className="mobile-cta">
      <SLLink href="/register" variant="primary" block>
        Start your return, from £99
      </SLLink>
    </div>
  );
}
