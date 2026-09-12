import { describe, expect, it } from "vitest";
import {
  BASE_PALETTE,
  baseColorFor,
  baseColorIndex,
  baseLabel,
  clampIndex,
  filterProjects,
  getVisibleProjects,
  groupProjectsByBase,
  moveSelection,
  normalizeBaseDir,
  normalizeQuery,
  normalizeSortMode,
  sortProjects,
  type Project,
} from "./model";

function project(name: string, base = "/Users/you/Programs"): Project {
  return { name, path: `${base}/${name}`, base };
}

describe("normalizeQuery", () => {
  it("trims and lowercases", () => {
    expect(normalizeQuery("  QuickSpot ")).toBe("quickspot");
  });

  it("whitespace only is empty", () => {
    expect(normalizeQuery("   ")).toBe("");
  });
});

describe("filterProjects", () => {
  const all = [project("QuickSpot"), project("AGENTS_SKILL-Docs"), project("CodeDock")];

  it("empty query returns everything in order", () => {
    expect(filterProjects(all, "")).toEqual(all);
    expect(filterProjects(all, "   ")).toEqual(all);
  });

  it("filters by name case-insensitively", () => {
    expect(filterProjects(all, "quick")).toEqual([project("QuickSpot")]);
    expect(filterProjects(all, "CODE")).toEqual([project("CodeDock")]);
  });

  it("also matches by path", () => {
    const withPaths = [...all, project("other", "/Users/you/Others")];
    expect(filterProjects(withPaths, "others")).toEqual([project("other", "/Users/you/Others")]);
  });

  it("no matches returns empty", () => {
    expect(filterProjects(all, "zzz")).toEqual([]);
  });
});

describe("clampIndex", () => {
  it("empty list -> -1", () => {
    expect(clampIndex(0, 0)).toBe(-1);
    expect(clampIndex(5, 0)).toBe(-1);
  });

  it("clamps to the edges", () => {
    expect(clampIndex(-1, 3)).toBe(0);
    expect(clampIndex(0, 3)).toBe(0);
    expect(clampIndex(2, 3)).toBe(2);
    expect(clampIndex(3, 3)).toBe(2);
    expect(clampIndex(99, 3)).toBe(2);
  });
});

describe("moveSelection", () => {
  it("empty list -> -1", () => {
    expect(moveSelection(0, 1, 0)).toBe(-1);
  });

  it("moves forward and back with wrap-around", () => {
    expect(moveSelection(0, 1, 3)).toBe(1);
    expect(moveSelection(2, 1, 3)).toBe(0);
    expect(moveSelection(0, -1, 3)).toBe(2);
    expect(moveSelection(1, -1, 3)).toBe(0);
  });

  it("no previous selection starts at an edge", () => {
    expect(moveSelection(-1, 1, 3)).toBe(0);
    expect(moveSelection(-1, -1, 3)).toBe(2);
  });
});

describe("normalizeBaseDir", () => {
  it("drops trailing slashes except root", () => {
    expect(normalizeBaseDir("/a/")).toBe("/a");
    expect(normalizeBaseDir("/a///")).toBe("/a");
    expect(normalizeBaseDir("  /a/b/  ")).toBe("/a/b");
    expect(normalizeBaseDir("/")).toBe("/");
    expect(normalizeBaseDir("  ")).toBe("");
  });

  it("keeps already normalized paths untouched", () => {
    expect(normalizeBaseDir("/Users/c/Programs")).toBe("/Users/c/Programs");
  });
});

describe("normalizeSortMode", () => {
  it("defaults to name", () => {
    expect(normalizeSortMode(undefined)).toBe("name");
    expect(normalizeSortMode(null)).toBe("name");
    expect(normalizeSortMode("")).toBe("name");
    expect(normalizeSortMode("hyper")).toBe("name");
    expect(normalizeSortMode("name")).toBe("name");
  });

  it("accepts folder aliases in English and Spanish", () => {
    expect(normalizeSortMode("base")).toBe("base");
    expect(normalizeSortMode("  Carpetas ")).toBe("base");
    expect(normalizeSortMode("FOLDER")).toBe("base");
    expect(normalizeSortMode("por_carpeta")).toBe("base");
  });
});

describe("baseLabel", () => {
  it("uses the last segment", () => {
    expect(baseLabel("/Users/you/Programs")).toBe("Programs");
    expect(baseLabel("/Users/you/AndroidApps/")).toBe("AndroidApps");
    expect(baseLabel("/")).toBe("/");
  });
});

describe("sortProjects", () => {
  it("by name: global alphabetical case-insensitively", () => {
    const all = [project("Zeta", "/b"), project("alfa", "/a"), project("Beta", "/b")];
    expect(sortProjects(all, "name").map((p) => p.name)).toEqual(["alfa", "Beta", "Zeta"]);
    // Does not mutate the original.
    expect(all[0].name).toBe("Zeta");
  });

  it("by base: groups by folder and sorts by name inside", () => {
    const all = [
      project("Zeta", "/b"),
      project("alfa", "/a"),
      project("Beta", "/b"),
    ];
    const sorted = sortProjects(all, "base");
    expect(sorted.map((p) => `${p.base}/${p.name}`)).toEqual([
      "/a/alfa",
      "/b/Beta",
      "/b/Zeta",
    ]);
  });
});

describe("colors per base folder", () => {
  it("same base -> same color, always (deterministic)", () => {
    expect(baseColorFor("/Users/you/Programs")).toEqual(
      baseColorFor("/Users/you/Programs"),
    );
    expect(baseColorIndex("/a")).toBeGreaterThanOrEqual(0);
    expect(baseColorIndex("/a")).toBeLessThan(BASE_PALETTE.length);
  });

  it("the palette has soft translucent tints and solid accents", () => {
    expect(BASE_PALETTE.length).toBe(8);
    for (const c of BASE_PALETTE) {
      expect(c.bg).toMatch(/^rgba\(/);
      expect(c.accent).toMatch(/^#/);
      expect(c.border).toMatch(/^rgba\(/);
    }
  });

  it("groups keeping arrival order", () => {
    const sorted = sortProjects(
      [project("Zeta", "/b"), project("alfa", "/a"), project("Beta", "/b")],
      "base",
    );
    const groups = groupProjectsByBase(sorted);
    expect(groups.map((g) => g.base)).toEqual(["/a", "/b"]);
    expect(groups[1].items.map((p) => p.name)).toEqual(["Beta", "Zeta"]);
    expect(groups[0].label).toBe("a");
  });

  it("getVisibleProjects filters and sorts together", () => {
    const all = [project("Zeta", "/b"), project("alfa", "/a"), project("Beta", "/b")];
    expect(getVisibleProjects(all, "", "base").map((p) => p.name)).toEqual([
      "alfa",
      "Beta",
      "Zeta",
    ]);
    expect(getVisibleProjects(all, "beta", "base").map((p) => p.name)).toEqual(["Beta"]);
  });
});

describe("visible projects with an active filter", () => {
  it("hides non-matching projects until the filter is cleared", () => {
    const all = [project("QuickSpot"), project("CodeDock")];
    const after = [...all, project("SonicaStudio", "/Users/c/AndroidApps")];
    // Composed behavior (filter + sort): a query only shows matches,
    // clearing it reveals everything including newly added bases.
    expect(getVisibleProjects(after, "programs", "name").map((p) => p.name)).toEqual([
      "CodeDock",
      "QuickSpot",
    ]);
    expect(getVisibleProjects(after, "", "name").map((p) => p.name)).toEqual([
      "CodeDock",
      "QuickSpot",
      "SonicaStudio",
    ]);
  });
});
