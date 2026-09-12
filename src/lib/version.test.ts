import { describe, expect, it } from "vitest";

import { formatVersion, resolveDisplayVersion } from "./version";

describe("formatVersion", () => {
  it("prefixes v to a bare version", () => {
    expect(formatVersion("0.1.0")).toBe("v0.1.0");
  });

  it("keeps an existing v and trims spaces", () => {
    expect(formatVersion("  v0.1.0  ")).toBe("v0.1.0");
    expect(formatVersion("  1.2.3  ")).toBe("v1.2.3");
  });

  it("returns empty with nothing to show", () => {
    expect(formatVersion("")).toBe("");
    expect(formatVersion("   ")).toBe("");
    expect(formatVersion(undefined)).toBe("");
    expect(formatVersion(null)).toBe("");
    expect(formatVersion(42)).toBe("");
  });
});

describe("resolveDisplayVersion", () => {
  it("picks the first non-empty candidate in order (Tauri > backup)", () => {
    expect(resolveDisplayVersion(["0.1.0", "9.9.9"])).toBe("v0.1.0");
    expect(resolveDisplayVersion(["", "0.1.0"])).toBe("v0.1.0");
    expect(resolveDisplayVersion([undefined, "  ", "2.0.0"])).toBe("v2.0.0");
    expect(resolveDisplayVersion([])).toBe("");
    expect(resolveDisplayVersion(["", "  ", undefined])).toBe("");
  });
});
