import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

// Backup version for when the frontend runs outside Tauri
// (browser with `npm run dev`): read from package.json at build
// time, never hardcoded. Under Tauri the primary source is
// `getVersion()` from `@tauri-apps/api/app` (tauri.conf.json > version,
// with fallback to Cargo.toml per the Tauri v2 docs).
const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
) as { version?: string };

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
  },
  build: {
    target: "es2022",
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version ?? "0.0.0"),
  },
  envPrefix: ["VITE_", "TAURI_"],
});
