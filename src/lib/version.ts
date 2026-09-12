/**
 * App version without hardcoding.
 *
 * Primary source (runtime, under Tauri): `getVersion()` from
 * `@tauri-apps/api/app`, which returns `tauri.conf.json > version`
 * (with fallback to `Cargo.toml > package.version` per the
 * Tauri v2 docs). Backup (outside Tauri, e.g. browser with
 * `npm run dev` or tests): `__APP_VERSION__`,
 * injected at build time from `package.json` via `define`
 * in `vite.config.ts` / `vitest.config.ts`.
 */
import { getVersion } from "@tauri-apps/api/app";

declare const __APP_VERSION__: string | undefined;

/** Normalizes for display: `"0.1.0"` -> `"v0.1.0"`, `"v0.1.0"` kept as is. */
export function formatVersion(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const v = raw.trim();
  if (v === "") return "";
  return v.startsWith("v") ? v : `v${v}`;
}

/**
 * Picks what to show: first non-empty candidate (already formatted).
 * Pure and testable: the real priority (Tauri > build) is decided by
 * `getAppVersion`, this only orders.
 */
export function resolveDisplayVersion(candidates: readonly unknown[]): string {
  for (const c of candidates) {
    const formatted = formatVersion(c);
    if (formatted !== "") return formatted;
  }
  return "";
}

/** Build-time injected version from `package.json` (or `""`). */
export function buildVersion(): string {
  try {
    // `typeof` over a missing `define` is safe: it yields "undefined".
    if (typeof __APP_VERSION__ === "string") return __APP_VERSION__.trim();
  } catch {
    // Environment without the `define` (e.g. imported outside Vite): no backup.
  }
  return "";
}

/**
 * Raw version (`"0.1.0"`): Tauri first, build backup after.
 * Never throws: when both are missing it returns `""` and the UI hides the badge.
 */
export async function getAppVersion(): Promise<string> {
  try {
    const v = await getVersion();
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  } catch {
    // Outside Tauri (`npm run dev` in a browser): use the backup.
  }
  return buildVersion();
}
