// Streamed while the admin case-detail queries run. Mimics the header
// + progress bar + two-column content + chat shell.
export default function AdminCaseLoading() {
  return (
    <>
      <div className="mb-6 sm:mb-10">
        <div className="h-3 w-40 rounded bg-cloud animate-pulse" />
        <div className="mt-3 h-9 w-64 rounded bg-cloud animate-pulse" />
        <div className="mt-3 h-4 w-72 max-w-full rounded bg-cloud animate-pulse" />
      </div>

      <div className="mb-8">
        <div className="card-sl flex items-center gap-3 p-4">
          <div className="h-5 w-24 rounded-full bg-cloud animate-pulse" />
          <div className="h-5 w-20 rounded-full bg-cloud animate-pulse" />
          <div className="h-5 w-28 rounded-full bg-cloud animate-pulse" />
          <div className="ml-auto h-5 w-32 rounded bg-cloud animate-pulse" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="card-sl space-y-4 p-6 sm:p-8">
          <div className="h-5 w-40 rounded bg-cloud animate-pulse" />
          <div className="h-3 w-full rounded bg-cloud animate-pulse" />
          <div className="h-3 w-11/12 rounded bg-cloud animate-pulse" />
          <div className="h-24 w-full rounded-lg bg-cloud animate-pulse" />
        </section>
        <aside className="card-sl space-y-4 p-6 sm:p-8">
          <div className="h-5 w-32 rounded bg-cloud animate-pulse" />
          <div className="h-3 w-full rounded bg-cloud animate-pulse" />
          <div className="h-48 w-full rounded-lg bg-cloud animate-pulse" />
        </aside>
      </div>
    </>
  );
}
