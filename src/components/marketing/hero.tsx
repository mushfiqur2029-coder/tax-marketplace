"use client";

import { useEffect, useState } from "react";
import { SLLink } from "@/components/sl-button";
import { BlobField } from "@/components/blob-field";

const REFUND_TARGET = 1240;

export function Hero() {
  const [amount, setAmount] = useState(0);
  const [barWidth, setBarWidth] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setAmount(REFUND_TARGET);
      setBarWidth(72);
      return;
    }
    const timer = setTimeout(() => {
      setBarWidth(72);
      let cur = 0;
      const step = Math.max(1, Math.round(REFUND_TARGET / 36));
      let raf = 0;
      const tick = () => {
        cur += step;
        if (cur >= REFUND_TARGET) {
          setAmount(REFUND_TARGET);
          return;
        }
        setAmount(cur);
        raf = requestAnimationFrame(tick);
      };
      tick();
      return () => cancelAnimationFrame(raf);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <section className="relative overflow-hidden pb-20 pt-16 sm:pt-24">
      <BlobField />
      <div className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
          <div>
            <span className="eyebrow">Tax &amp; VAT, sorted</span>
            <h1
              className="mt-5 text-4xl leading-[1.03] sm:text-5xl lg:text-6xl"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              The tax app
              <br />
              for <span className="gradient-text">everyone.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base text-slate sm:text-lg">
              Self Assessment, VAT, landlords, freelancers, and small
              businesses. Answer a few questions, upload your documents, and a
              real UK accountant takes it from there.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <SLLink href="#pricing" variant="primary">
                Start your return
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                >
                  <path d="M4 10h12M11 5l5 5-5 5" />
                </svg>
              </SLLink>
              <SLLink href="#how" variant="ghost">
                See how it works
              </SLLink>
            </div>
            <div className="mt-8 flex items-center gap-3 text-sm font-semibold text-slate">
              <div className="avatar-stack">
                <span />
                <span />
                <span />
                <span />
              </div>
              Vetted ACCA · CIMA · CTA accountants only
            </div>
          </div>

          <div
            className="relative mx-auto w-full max-w-md"
            style={{ perspective: "1200px" }}
          >
            <div className="app-card">
              <div className="app-card-top">
                <div className="app-dots">
                  <span />
                  <span />
                  <span />
                </div>
                <span className="app-pill">● Filed on time</span>
              </div>
              <div className="app-row">
                <span className="l">Return</span>
                <span className="v">Self-employed · 25/26</span>
              </div>
              <div className="app-row">
                <span className="l">Accountant</span>
                <span className="v">R. Okafor, ACCA</span>
              </div>
              <div className="app-row">
                <span className="l">VAT status</span>
                <span className="v">Not registered</span>
              </div>
              <div className="app-amount">
                <div className="cap">Estimated refund</div>
                <div className="num">£{amount.toLocaleString()}</div>
                <div className="app-bar">
                  <div
                    className="app-bar-fill"
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </div>
            </div>
            <div className="float-badge fb-1">
              <span className="ic">✓</span> Docs uploaded
            </div>
            <div className="float-badge fb-2">
              <span className="ic">£</span> Paid securely
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
