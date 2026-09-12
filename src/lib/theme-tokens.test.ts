import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  BASE_PALETTE,
  BASE_PALETTE_LIGHT,
} from "./model";
import {
  THEME_IDS,
  THEME_META,
  type ThemeId,
} from "./theme";

/**
 * Contrast gate for the curated themes: parses the shipped `style.css`
 * token blocks and fails the suite when any theme drops below WCAG 2.1 AA.
 * Tune palette hex values against this gate, never by eye.
 */

// Read the exact shipped file from disk: `?raw` returns an empty module
// for `.css` under this vitest setup, so the gate parses the file itself.
const styleCss: string = readFileSync(new URL("../style.css", import.meta.url), "utf8");

const TOKENS = [
  "bg",
  "surface",
  "surface-2",
  "selected",
  "selected-border",
  "text",
  "muted",
  "faint",
  "accent",
  "danger",
  "border",
  "hairline",
] as const;

function blockFor(selector: string): string {
  const pattern = new RegExp(
    selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}",
  );
  const match = pattern.exec(styleCss);
  if (!match?.[1]) throw new Error(`missing CSS block: ${selector}`);
  return match[1];
}

function tokenValue(block: string, name: string): string {
  const match = new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(block);
  if (!match?.[1]) throw new Error(`missing token --${name}`);
  return match[1].trim();
}

function propValue(block: string, name: string): string {
  const match = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+);`).exec(block);
  if (!match?.[1]) throw new Error(`missing property ${name}`);
  return match[1].trim();
}

function parseHex(color: string): [number, number, number] {
  const hex = color.trim().toLowerCase();
  const match = /^#([0-9a-f]{6})$/.exec(hex);
  if (!match?.[1]) throw new Error(`not a 6-digit hex color: ${color}`);
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function luminance(color: string): number {
  const [r, g, b] = parseHex(color).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio between two opaque hex colors. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function themeTokens(id: ThemeId): Record<string, string> {
  const block = blockFor(`[data-theme="${id}"]`);
  const out: Record<string, string> = {};
  for (const name of TOKENS) out[name] = tokenValue(block, name);
  return out;
}

describe("theme token blocks", () => {
  it("ships all 8 curated themes plus a dark :root base", () => {
    for (const id of THEME_IDS) {
      expect(styleCss).toContain(`[data-theme="${id}"]`);
    }
    const root = blockFor(":root");
    const dark = blockFor(`[data-theme="codedock-dark"]`);
    for (const name of TOKENS) {
      expect(tokenValue(root, name)).toBe(tokenValue(dark, name));
    }
  });

  it("declares color-scheme matching the theme group", () => {
    for (const id of THEME_IDS) {
      const block = blockFor(`[data-theme="${id}"]`);
      expect(propValue(block, "color-scheme")).toBe(THEME_META[id].scheme);
    }
  });
});

describe("theme contrast minimums (WCAG 2.1 AA)", () => {
  for (const id of THEME_IDS) {
    describe(id, () => {
      const t = themeTokens(id);

      it("body text stays readable on every surface (≥ 4.5:1)", () => {
        for (const surface of [t["bg"], t["surface"], t["surface-2"]]) {
          expect(contrastRatio(t["text"], surface)).toBeGreaterThanOrEqual(4.5);
        }
      });

      it("secondary text stays readable on bg and surface (≥ 4.5:1)", () => {
        for (const surface of [t["bg"], t["surface"]]) {
          expect(contrastRatio(t["muted"], surface)).toBeGreaterThanOrEqual(4.5);
        }
      });

      it("faint placeholders keep large-text minimum on bg (≥ 3:1)", () => {
        expect(contrastRatio(t["faint"], t["bg"])).toBeGreaterThanOrEqual(3);
      });

      it("accent keeps non-text minimum on bg (≥ 3:1)", () => {
        expect(contrastRatio(t["accent"], t["bg"])).toBeGreaterThanOrEqual(3);
      });

      it("error text stays readable on bg and surface (≥ 4.5:1)", () => {
        for (const surface of [t["bg"], t["surface"]]) {
          expect(contrastRatio(t["danger"], surface)).toBeGreaterThanOrEqual(4.5);
        }
      });

      it("selection edge keeps non-text minimum (≥ 3:1)", () => {
        expect(contrastRatio(t["selected-border"], t["selected"])).toBeGreaterThanOrEqual(3);
      });

      it("group-label accent keeps non-text minimum on surface (≥ 3:1)", () => {
        const accent = tokenValue(blockFor(`[data-theme="${id}"]`), "base-accent");
        expect(contrastRatio(accent, t["surface"])).toBeGreaterThanOrEqual(3);
      });
    });
  }
});

describe("light tint separation", () => {
  const LIGHT_IDS = THEME_IDS.filter((id) => THEME_META[id].scheme === "light");

  it("covers exactly the 3 light themes", () => {
    expect([...LIGHT_IDS].sort()).toEqual(["codedock-light", "harbor-mist", "parchment"]);
  });

  it("never reuses dark rgba tints on light surfaces", () => {
    for (const id of LIGHT_IDS) {
      const block = blockFor(`[data-theme="${id}"]`);
      expect(tokenValue(block, "base-bg")).not.toContain("rgba(");
      expect(tokenValue(block, "base-border")).not.toContain("rgba(");
    }
    for (const c of BASE_PALETTE_LIGHT) {
      expect(c.bg).not.toContain("rgba(");
      expect(c.border).not.toContain("rgba(");
    }
  });

  it("keeps light group accents readable on every light surface (≥ 3:1)", () => {
    const surfaces = LIGHT_IDS.map((id) => themeTokens(id)["surface"]);
    for (const c of BASE_PALETTE_LIGHT) {
      for (const surface of surfaces) {
        expect(contrastRatio(c.accent, surface)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("keeps dark group accents readable on every dark surface (≥ 3:1)", () => {
    const darkIds = THEME_IDS.filter((id) => THEME_META[id].scheme === "dark");
    const surfaces = darkIds.map((id) => themeTokens(id)["surface"]);
    for (const c of BASE_PALETTE) {
      for (const surface of surfaces) {
        expect(contrastRatio(c.accent, surface)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
