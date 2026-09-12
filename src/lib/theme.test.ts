import { describe, expect, it } from "vitest";

import { translate } from "./i18n";
import {
  DEFAULT_THEME_SETTING,
  normalizeThemeSetting,
  resolveEffectiveTheme,
  THEME_IDS,
  THEME_META,
  themeNameKey,
  themeScheme,
  type ThemeId,
} from "./theme";

describe("normalizeThemeSetting", () => {
  it("defaults to auto-follow-system", () => {
    expect(DEFAULT_THEME_SETTING).toBe("auto");
    expect(normalizeThemeSetting(undefined)).toBe("auto");
    expect(normalizeThemeSetting(null)).toBe("auto");
    expect(normalizeThemeSetting("")).toBe("auto");
    expect(normalizeThemeSetting("auto")).toBe("auto");
    expect(normalizeThemeSetting("system")).toBe("auto");
  });

  it("keeps the 8 locked ids and maps unknown values to auto", () => {
    for (const id of THEME_IDS) {
      expect(normalizeThemeSetting(id)).toBe(id);
    }
    expect(normalizeThemeSetting("neon-hacker")).toBe("auto");
    expect(normalizeThemeSetting("dark")).toBe("auto");
    expect(normalizeThemeSetting(42)).toBe("auto");
  });

  it("trims and lowercases before matching", () => {
    expect(normalizeThemeSetting("  Parchment ")).toBe("parchment");
  });
});

describe("resolveEffectiveTheme", () => {
  it("keeps an explicit choice regardless of the OS scheme", () => {
    expect(resolveEffectiveTheme("parchment", false)).toBe("parchment");
    expect(resolveEffectiveTheme("parchment", true)).toBe("parchment");
    expect(resolveEffectiveTheme("abyss-blue", true)).toBe("abyss-blue");
  });

  it("resolves auto through the default pair", () => {
    expect(resolveEffectiveTheme("auto", false)).toBe("codedock-dark");
    expect(resolveEffectiveTheme("auto", true)).toBe("codedock-light");
    expect(resolveEffectiveTheme(undefined, true)).toBe("codedock-light");
    expect(resolveEffectiveTheme("neon-hacker", false)).toBe("codedock-dark");
  });
});

describe("theme metadata", () => {
  it("locks 5 dark + 3 light themes with codedock-light on light", () => {
    expect(THEME_IDS).toHaveLength(8);
    const dark = THEME_IDS.filter((id) => THEME_META[id].scheme === "dark");
    const light = THEME_IDS.filter((id) => THEME_META[id].scheme === "light");
    expect(dark).toHaveLength(5);
    expect(light).toHaveLength(3);
    expect(THEME_META["codedock-light"].scheme).toBe("light");
  });

  it("reports the scheme per theme", () => {
    expect(themeScheme("kelp-night")).toBe("dark");
    expect(themeScheme("parchment")).toBe("light");
  });

  it("names every theme in English and Spanish", () => {
    const ids: ThemeId[] = [...THEME_IDS];
    for (const id of ids) {
      const key = themeNameKey(id);
      expect(translate("en", key)).not.toBe(key);
      expect(translate("es", key)).not.toBe(key);
    }
    expect(translate("en", "settings.theme")).toBe("Theme");
    expect(translate("es", "settings.theme")).toBe("Tema");
    expect(translate("en", "settings.themeAuto")).toBe("System (auto)");
    expect(translate("es", "settings.themeAuto")).toBe("Sistema (auto)");
  });
});
