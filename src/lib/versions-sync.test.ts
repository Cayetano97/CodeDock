import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import pkg from "../../package.json";
import tauriConf from "../../src-tauri/tauri.conf.json";
import cargoToml from "../../src-tauri/Cargo.toml?raw";
import { isVersionTagMatch, normalizeTag } from "./version";

/**
 * The version lives in three places (standard Tauri template) and the
 * frontend reads it at runtime (`getVersion`) / build time
 * (`__APP_VERSION__` from `package.json`), never hardcoded.
 * This test keeps the three sources from drifting on a version bump.
 */
describe("versions in sync", () => {
  it("package.json, tauri.conf.json and Cargo.toml agree on semver", () => {
    const cargoVersion = /^version\s*=\s*"([^"]+)"\s*$/m.exec(cargoToml)?.[1];

    expect(typeof pkg.version).toBe("string");
    expect(typeof tauriConf.version).toBe("string");
    expect(typeof cargoVersion).toBe("string");
    expect(tauriConf.version).toBe(pkg.version);
    expect(cargoVersion).toBe(pkg.version);
    // Loose semver (allows pre-release/build): 0.1.0, 1.2.3-beta.1, …
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/);
  });

  it("matches a v-prefixed tag against the synced version (tag-guard logic)", () => {
    const version = pkg.version as string;
    expect(normalizeTag(`v${version}`)).toBe(version);
    expect(normalizeTag(version)).toBe(version);
    expect(isVersionTagMatch(`v${version}`, version)).toBe(true);
    // Drifted tag is blocked: v1.2.4 while the synced version is 1.2.3.
    expect(isVersionTagMatch("v1.2.4", "1.2.3")).toBe(false);
    expect(isVersionTagMatch(`v${version}`, "9.9.9")).toBe(false);
    expect(isVersionTagMatch("", version)).toBe(false);
    expect(isVersionTagMatch(`v${version}`, "")).toBe(false);
  });

  it("tag-guard workflow reads package.json, tauri.conf.json and Cargo.toml", () => {
    const releaseYml = readFileSync(
      new URL("../../.github/workflows/release.yml", import.meta.url),
      "utf8",
    );
    expect(releaseYml).toContain("package.json");
    expect(releaseYml).toContain("tauri.conf.json");
    expect(releaseYml).toContain("Cargo.toml");
    // Guard strips the leading `v` and compares against all three sources.
    expect(releaseYml).toContain("GITHUB_REF_NAME");
    // Drifted tags fail before any Release is created.
    expect(releaseYml).toContain("needs: tag-guard");
  });
});
