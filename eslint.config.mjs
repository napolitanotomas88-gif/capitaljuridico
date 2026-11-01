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
    // Finanzas SKWD (1/11/2026): pantallas copiadas tal cual de la app original (JavaScript, con su propio oxlint)
    "components/finanzas/skwd/*.jsx",
    "components/finanzas/skwd/calculo*.js",
  ]),
]);

export default eslintConfig;
