import { Reveal } from "./reveal";

const FEATURES = [
  "Live status on every case, no chasing emails",
  "Direct chat with your assigned accountant",
  "Bank-level secure document storage",
  "One tap approval before anything is filed",
];

export function AppShowcase() {
  return (
    <section id="app-preview" className="py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal className="app-showcase">
          <div className="showcase-grid">
            <div className="showcase-copy">
              <span className="eyebrow" style={{ color: "#7FD9F0" }}>
                Built to become an app
              </span>
              <h2 className="mt-3">Your whole tax life, in one dashboard.</h2>
              <p>
                Track every return, chat with your accountant, and see exactly
                what's happening, from your phone or your laptop.
              </p>
              <ul className="showcase-list">
                {FEATURES.map((f) => (
                  <li key={f}>
                    <span className="dot">✓</span> {f}
                  </li>
                ))}
              </ul>
            </div>
            <div className="mock-window">
              <div className="mock-topbar">
                <span />
                <span />
                <span />
              </div>
              <div className="mock-body">
                <div className="mock-title">Your returns</div>
                <MockCase
                  who="Self Assessment 25/26"
                  what="R. Okafor, ACCA"
                  tagColor="green"
                  tagText="Filed"
                />
                <MockCase
                  who="VAT Q2 2026"
                  what="S. Patel, CTA"
                  tagColor="blue"
                  tagText="In review"
                />
                <MockCase
                  who="CIS Rebate"
                  what="Unassigned"
                  tagColor="amber"
                  tagText="Awaiting accountant"
                />
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function MockCase({
  who,
  what,
  tagColor,
  tagText,
}: {
  who: string;
  what: string;
  tagColor: "green" | "blue" | "amber";
  tagText: string;
}) {
  return (
    <div className="mock-case">
      <div>
        <div className="who">{who}</div>
        <div className="what">{what}</div>
      </div>
      <span className={`mock-tag ${tagColor}`}>{tagText}</span>
    </div>
  );
}
