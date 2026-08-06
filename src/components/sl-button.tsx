import * as React from "react";
import Link from "next/link";

type Variant = "primary" | "ghost" | "outline";

type CommonProps = {
  variant?: Variant;
  block?: boolean;
  className?: string;
  children: React.ReactNode;
};

const classFor = ({
  variant = "primary",
  block,
  className = "",
}: Pick<CommonProps, "variant" | "block" | "className">) => {
  const parts = ["btn-sl", `btn-sl-${variant}`];
  if (block) parts.push("btn-sl-block");
  if (className) parts.push(className);
  return parts.join(" ");
};

export function SLButton({
  variant,
  block,
  className,
  children,
  ...rest
}: CommonProps & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={classFor({ variant, block, className })} {...rest}>
      {children}
    </button>
  );
}

export function SLLink({
  href,
  variant,
  block,
  className,
  children,
  ...rest
}: CommonProps & { href: string } & Omit<
    React.AnchorHTMLAttributes<HTMLAnchorElement>,
    "className" | "href" | "children"
  >) {
  return (
    <Link href={href} className={classFor({ variant, block, className })} {...rest}>
      {children}
    </Link>
  );
}
