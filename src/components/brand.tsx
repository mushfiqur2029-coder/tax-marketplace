import Link from "next/link";

type Props = {
  href?: string;
  className?: string;
};

export function Brand({ href = "/", className = "" }: Props) {
  return (
    <Link
      href={href}
      className={
        "inline-flex items-center gap-2 no-underline " + className
      }
    >
      <span
        aria-hidden="true"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white text-sm font-bold"
        style={{
          background:
            "linear-gradient(135deg, var(--color-navy) 0%, var(--color-sky) 100%)",
          fontFamily: "var(--font-heading)",
          letterSpacing: "-0.02em",
        }}
      >
        SL
      </span>
      <span
        className="font-heading text-lg font-bold text-navy-deep"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        Sterling<span className="text-sky">Ledger</span>
      </span>
    </Link>
  );
}
