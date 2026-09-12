import { describe, expect, it } from "vitest";

import pkg from "../../package.json";
import tauriConf from "../../src-tauri/tauri.conf.json";
import cargoToml from "../../src-tauri/Cargo.toml?raw";

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
});
