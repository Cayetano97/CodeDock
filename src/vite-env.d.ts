/// <reference types="vite/client" />

// Minimal `node:fs` typing for the theme contrast gate
// (`src/lib/theme-tokens.test.ts` reads the shipped CSS from disk).
// The repo ships no @types/node by design (no new packages for theming).
declare module "node:fs" {
  export function readFileSync(path: URL, encoding: "utf8"): string;
}
