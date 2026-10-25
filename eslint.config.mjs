import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // react/no-unescaped-entities fires on raw ' and " inside JSX text
  // children. We deliberately author the PCH client intake with real
  // apostrophes and quotes rather than HTML entities, because entities
  // only decode inside JSX text and silently break when the exact same
  // string is passed to a component prop (helpText="can&apos;t" renders
  // the raw entity source). One rule everywhere beats remembering which
  // position a given string will end up in. See the Phase H brief.
  {
    files: [
      // The [id] folder segment is literal, not a glob character class;
      // minimatch requires it to be escaped (or glob-expanded by **).
      "src/app/client/cases/**/pch/**/*.{ts,tsx}",
      "src/app/client/pch/**/*.{ts,tsx}",
      "src/app/accountant/cases/**/pch/**/*.{ts,tsx}",
    ],
    rules: {
      "react/no-unescaped-entities": "off",
    },
  },
]);

export default eslintConfig;
