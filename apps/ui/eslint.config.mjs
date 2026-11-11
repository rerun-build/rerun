import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      'no-restricted-properties': [
        'error',
        {
          property: 'randomUUID',
          message: "crypto.randomUUID is undefined outside a secure context (a self-host opened over plain HTTP on a LAN IP). Use randomUuid() from '@/lib/random-uuid'.",
        },
      ],
    },
  },
  {
    files: ['lib/random-uuid.ts', 'lib/random-uuid.test.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    files: ['**/*actions.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportNamedDeclaration[exportKind="type"][declaration=null]',
          message: "Next's 'use server' transform registers `export type { X }` as a runtime server action, which throws ReferenceError on every request to the route. Import the type from its source module at the consumer instead.",
        },
        {
          selector: 'ExportNamedDeclaration > ExportSpecifier[exportKind="type"]',
          message: "Next's 'use server' transform may register `export { type X }` as a runtime server action. Import the type from its source module at the consumer instead.",
        },
      ],
    },
  },
  // The React Compiler rules of eslint-plugin-react-hooks 6 flag patterns the app relies on without the
  // compiler, and the vendored hairline kernel is checked by its own upstream. Reported, not blocking.
  // Scoped to the files eslint-config-next loads the plugins for: a `.cjs` file would find no plugin.
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/use-memo': 'warn',
      'react/no-unescaped-entities': 'warn',
    },
  },
  // A CommonJS module (the end-to-end suite's helpers, shared with a plain Node script) imports with require.
  {
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  globalIgnores(['lib/hairline/*.js']),
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
