import { Brand } from "@/components/brand";
import { SignOutButton } from "@/components/sign-out-button";

type Props = {
  title: string;
  eyebrow: string;
  description: string;
  email: string;
  role: string;
  name?: string | null;
  headerExtra?: React.ReactNode;
  subnav?: React.ReactNode;
  children: React.ReactNode;
};

export function DashboardShell({
  title,
  eyebrow,
  description,
  email,
  role,
  name,
  headerExtra,
  subnav,
  children,
}: Props) {
  // For clients + accountants we prefer a "Welcome, [Name]" greeting; admins
  // don't have a profile row, so they fall through to email.
  const greeting = name?.trim() ? `Welcome, ${name.trim()}` : email;
  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-40 border-b border-line/60 bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Brand />
          <div className="flex items-center gap-3 sm:gap-4">
            {headerExtra}
            <div className="hidden text-right sm:block">
              <div className="text-xs font-semibold text-ink">{greeting}</div>
              <div
                className="text-[10px] uppercase tracking-widest text-slate"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {role}
              </div>
            </div>
            <SignOutButton />
          </div>
        </div>
        {subnav ? (
          <div className="border-t border-line/60 bg-paper/60">
            <div className="mx-auto max-w-6xl px-4 sm:px-6">{subnav}</div>
          </div>
        ) : null}
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-8 sm:mb-10">
          <span className="eyebrow">{eyebrow}</span>
          <h1
            className="mt-3 text-3xl sm:text-4xl"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {title}
          </h1>
          <p className="mt-2 max-w-xl text-sm text-slate sm:text-base">
            {description}
          </p>
        </div>
        {children}
      </main>
    </div>
  );
}

export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint: string;
}) {
  return (
    <div className="card-sl border-dashed p-10 text-center sm:p-14">
      <div
        className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl text-white"
        style={{
          background:
            "linear-gradient(135deg, var(--color-navy), var(--color-sky))",
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M9 3h6l4 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
          <path d="M14 3v5h5" />
        </svg>
      </div>
      <p className="text-lg font-semibold text-ink">{title}</p>
      <p className="mt-2 text-sm text-slate">{hint}</p>
    </div>
  );
}
