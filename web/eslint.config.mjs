import { fixupConfigRules } from "@eslint/compat";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  // Next's plugin set still exposes the ESLint 9 rule API; adapt rather than
  // disable while the ecosystem finishes its ESLint 10 move (same as revnet-money).
  ...fixupConfigRules([...nextVitals, ...nextTypeScript]),
  globalIgnores([".next/**", "node_modules/**", "src/lib/patchbay.ts"]),
  {
    rules: {
      "react/no-unescaped-entities": "off",
    },
  },
]);
