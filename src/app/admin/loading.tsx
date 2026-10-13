// Streamed while the admin dashboard's data queries run. Mimics the
// eyebrow + title + metrics strip + case list the real page renders.
export default function AdminDashboardLoading() {
  return (
    <>
      <div className="mb-6 sm:mb-10">
        <div className="h-3 w-32 rounded bg-cloud animate-pulse" />
        <div className="mt-3 h-9 w-56 rounded bg-cloud animate-pulse" />
        <div className="mt-3 h-4 w-80 max-w-full rounded bg-cloud animate-pulse" />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card-sl p-4">
            <div className="h-3 w-20 rounded bg-cloud animate-pulse" />
            <div className="mt-3 h-6 w-16 rounded bg-cloud animate-pulse" />
          </div>
        ))}
      </div>

      <div className="mb-6">
        <div className="inline-flex rounded-full border border-line bg-paper p-1">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="mx-0.5 h-7 w-24 rounded-full bg-cloud animate-pulse"
            />
          ))}
        </div>
      </div>

      <ul className="grid gap-3">
        {[0, 1, 2, 3].map((i) => (
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
    </>
  );
}
