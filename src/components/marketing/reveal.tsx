"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

// useLayoutEffect on client, useEffect on server (no-op) to avoid SSR warning.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

type Phase = "initial" | "hidden" | "in";

type Props = {
  children: React.ReactNode;
  className?: string;
  style?: CSSProperties;
  delay?: number;
  as?: keyof React.JSX.IntrinsicElements;
};

export function Reveal({
  children,
  className = "",
  style,
  delay = 0,
  as = "div",
}: Props) {
  const [phase, setPhase] = useState<Phase>("initial");
  const ref = useRef<HTMLElement | null>(null);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduce || typeof IntersectionObserver === "undefined") {
      setPhase("in");
      return;
    }

    const rect = el.getBoundingClientRect();
    const inViewNow =
      rect.top < window.innerHeight * 0.85 && rect.bottom > 0;

    if (inViewNow) {
      // Above the fold: skip the animation, render visible immediately.
      setPhase("in");
      return;
    }

    setPhase("hidden");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setPhase("in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const parts = [className];
  if (phase === "hidden") parts.push("reveal");
  else if (phase === "in") parts.push("reveal", "in");
  const finalClassName = parts.filter(Boolean).join(" ");

  const Tag = as as string;
  return (
    // @ts-expect-error dynamic tag
    <Tag
      ref={ref}
      className={finalClassName}
      style={{
        transitionDelay: delay ? `${delay}s` : undefined,
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}
