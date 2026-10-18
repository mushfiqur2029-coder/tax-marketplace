import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Headless Chromium (@sparticuz/chromium) ships compressed binaries in
  // its own node_modules/.../bin directory and resolves them at runtime
  // via a disk path. Two things have to be right in production:
  //
  //   1. The package must be externalised, if Next bundles it, the
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
  // same reason, kept the include here.
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
  // PCH document uploads can be up to 50MB (bank statements, V5C scans,
  // high-resolution receipt photos). Server actions default to 1MB; raise
  // the limit so a legitimate upload isn't rejected before our own 50MB
  // check in uploadPchDocumentAction gets a say. Plus a few MB of
  // multipart headroom per the Next docs guidance.
  experimental: {
    // Server action body limit (default 1MB) + the Next 16 proxy layer
    // body limit (default 10MB) both have to clear the 50MB client-side
    // doc upload budget. Both set to 55mb so a 50MB file plus the few
    // extra KB of multipart overhead fits comfortably.
    serverActions: {
      bodySizeLimit: "55mb",
    },
    proxyClientMaxBodySize: "55mb",
  },
};

export default nextConfig;
