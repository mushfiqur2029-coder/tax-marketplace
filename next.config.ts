import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Headless Chromium (@sparticuz/chromium) ships compressed binaries in
  // its own node_modules/.../bin directory and resolves them at runtime
  // via a disk path. Two things have to be right in production:
  //
  //   1. The package must be externalised — if Next bundles it, the
  //      `bin/` directory never lands in the function and we get the
  //      "input directory /var/task/node_modules/@sparticuz/chromium/bin
  //      does not exist" error that broke the Limited Company sign flow
  //      in production. puppeteer-core and @sparticuz/chromium are both
  //      on Next's auto-externalise list, but we pin them explicitly so
  //      the dependency isn't silent and we don't rely on that list
  //      staying stable across Next upgrades.
  //
  //   2. File tracing has to pick up `bin/` even though no `import`
  //      statement references it. The include glob lists the binaries
  //      verbatim; `/*` so every route that could end up with the sign
  //      action in its bundle gets them.
  //
  // The engagement-letter PDF renderer also reads Logo3s.png off disk,
  // same reason — kept the include here.
  serverExternalPackages: [
    "@sparticuz/chromium",
    "puppeteer-core",
  ],
  outputFileTracingIncludes: {
    "/*": [
      "./design-reference/Logo3s.png",
      "./node_modules/@sparticuz/chromium/bin/**/*",
    ],
  },
};

export default nextConfig;
