import { Reveal } from "./reveal";

const STEPS = [
  {
    n: 1,
    title: "Tell us about your year",
    body: "Pick what fits: individual, self-employed, landlord, or VAT-registered, and answer a short set of questions built around it.",
  },
  {
    n: 2,
    title: "Upload and pay",
    body: "Send over what you've got and pay securely by card or bank transfer. Nothing starts until you've paid.",
  },
  {
    n: 3,
    title: "Your accountant takes it",
    body: "They prepare, message you if anything's missing, and file once you've approved it. You always know where things stand.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="py-24 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="section-head">
          <span className="eyebrow">How it works</span>
          <h2>Three steps. That's genuinely it.</h2>
          <p>
            You're not learning tax law. You're answering questions you already
            know, and letting someone qualified take it from there.
          </p>
        </div>
        <div className="flow-steps">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} className="flow-step" delay={i * 0.12}>
              <div className="flow-num">{s.n}</div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
