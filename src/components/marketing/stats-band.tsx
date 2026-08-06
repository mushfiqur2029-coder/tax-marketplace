"use client";

import { useEffect, useRef, useState } from "react";
import { Reveal } from "./reveal";

type Stat = { target: number; suffix: string; label: string };

const STATS: Stat[] = [
  { target: 150, suffix: "", label: "Vetted accountants" },
  { target: 98, suffix: "%", label: "Filed before deadline" },
  { target: 24, suffix: "h", label: "Avg. first response" },
  { target: 100, suffix: "%", label: "Accuracy guaranteed" },
];

export function StatsBand() {
  return (
    <section id="proof" className="py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal className="stats-band">
          {STATS.map((s) => (
            <div key={s.label} className="stat">
              <div className="num">
                <Counter target={s.target} suffix={s.suffix} />
              </div>
              <div className="label">{s.label}</div>
            </div>
          ))}
        </Reveal>
        <div className="stats-note">
          Illustrative targets for launch, to be updated with real figures once
          live.
        </div>
      </div>
    </section>
  );
}

function Counter({ target, suffix }: { target: number; suffix: string }) {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLSpanElement | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !started.current) {
            started.current = true;
            let cur = 0;
            const step = Math.max(1, Math.round(target / 40));
            let raf = 0;
            const tick = () => {
              cur += step;
              if (cur >= target) {
                setValue(target);
                return;
              }
              setValue(cur);
              raf = requestAnimationFrame(tick);
            };
            tick();
            io.unobserve(e.target);
            return () => cancelAnimationFrame(raf);
          }
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [target]);

  return (
    <span ref={ref}>
      {value}
      {suffix}
    </span>
  );
}
