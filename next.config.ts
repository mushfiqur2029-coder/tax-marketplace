import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The engagement-letter PDF renderer reads Logo3s.png off disk when it
  // builds HTML to hand to headless Chromium. Vercel's serverless bundler
  // only traces files it can see imported, so this binary asset has to be
  // force-included or production reads will 404. Scoped to all routes
  // because the sign action is a server action that could be bundled with
  // any page that imports it.
  outputFileTracingIncludes: {
    "/*": ["./design-reference/Logo3s.png"],
  },
};

export default nextConfig;
