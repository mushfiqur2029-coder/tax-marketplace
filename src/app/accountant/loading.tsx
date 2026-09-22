// Streamed while the accountant dashboard's data queries run. Uses the same
// card/pill shell language as the real page so the layout doesn't jump.
export default function AccountantLoading() {
  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-40 border-b border-line/60 bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="h-6 w-32 rounded-md bg-cloud animate-pulse" />
          <div className="h-8 w-8 rounded-xl bg-cloud animate-pulse" />
        </div>
        <div className="border-t border-line/60 bg-paper/60">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="flex gap-2 py-2">
              {["Cases", "Income", "Account"].map((label) => (
                <div key={label} className="h-7 w-20 rounded-full bg-cloud animate-pulse" />
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-8 sm:mb-10">
          <div className="h-3 w-32 rounded bg-cloud animate-pulse" />
          <div className="mt-3 h-9 w-40 rounded bg-cloud animate-pulse" />
          <div className="mt-3 h-4 w-80 max-w-full rounded bg-cloud animate-pulse" />
        </div>

        <div className="mb-6 space-y-3">
          <div className="inline-flex rounded-full border border-line bg-paper p-1">
            {["Live", "Queue", "Completed", "Pending"].map((label) => (
              <div key={label} className="h-7 w-20 rounded-full bg-cloud animate-pulse mx-0.5" />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-8 w-32 rounded-full bg-cloud animate-pulse" />
            ))}
          </div>
        </div>

        <ul className="grid gap-3">
          {[0, 1, 2].map((i) => (
            <li key={i} className="card-sl flex items-center gap-4 p-5">
              <div className="h-11 w-11 shrink-0 rounded-xl bg-cloud animate-pulse" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-48 rounded bg-cloud animate-pulse" />
                <div className="h-3 w-64 rounded bg-cloud animate-pulse" />
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="h-5 w-20 rounded-full bg-cloud animate-pulse" />
                <div className="h-4 w-16 rounded-full bg-cloud animate-pulse" />
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
