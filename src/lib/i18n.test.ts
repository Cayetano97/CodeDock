import { describe, expect, it } from "vitest";

import {
  DEFAULT_LANGUAGE,
  DEFAULT_LANGUAGE_SETTING,
  formatCount,
  formatGroupCount,
  formatVisibilityStatus,
  I18N_KEYS,
  normalizeLanguage,
  normalizeLanguageSetting,
  projectAriaLabel,
  removeBaseAriaLabel,
  resolveLanguage,
  systemLanguage,
  terminalHint,
  translate,
  versionAriaLabel,
  visibilityToggleAriaLabel,
} from "./i18n";

describe("normalizeLanguage", () => {
  it("falls back to English", () => {
    expect(DEFAULT_LANGUAGE).toBe("en");
    expect(normalizeLanguage(undefined)).toBe("en");
    expect(normalizeLanguage(null)).toBe("en");
    expect(normalizeLanguage("")).toBe("en");
    expect(normalizeLanguage("fr")).toBe("en");
    expect(normalizeLanguage(42)).toBe("en");
  });

  it("accepts English and Spanish locale tags", () => {
    expect(normalizeLanguage("en")).toBe("en");
    expect(normalizeLanguage("en-US")).toBe("en");
    expect(normalizeLanguage("es")).toBe("es");
    expect(normalizeLanguage("es-ES")).toBe("es");
    expect(normalizeLanguage("  ES_mx ")).toBe("es");
  });
});

describe("language setting (auto vs manual)", () => {
  it("defaults to auto-follow-system", () => {
    expect(DEFAULT_LANGUAGE_SETTING).toBe("auto");
    expect(normalizeLanguageSetting(undefined)).toBe("auto");
    expect(normalizeLanguageSetting(null)).toBe("auto");
    expect(normalizeLanguageSetting("")).toBe("auto");
    expect(normalizeLanguageSetting("auto")).toBe("auto");
    expect(normalizeLanguageSetting("system")).toBe("auto");
  });

  it("keeps an explicit choice and falls back to English", () => {
    expect(normalizeLanguageSetting("es")).toBe("es");
    expect(normalizeLanguageSetting("es-ES")).toBe("es");
    expect(normalizeLanguageSetting("en-US")).toBe("en");
    expect(normalizeLanguageSetting("fr")).toBe("en");
  });

  it("resolves auto from the system tag with English fallback", () => {
    expect(resolveLanguage("auto", "es-ES")).toBe("es");
    expect(resolveLanguage("auto", "en-US")).toBe("en");
    expect(resolveLanguage("auto", "fr-FR")).toBe("en");
    expect(resolveLanguage("auto", undefined)).toBe("en");
    expect(systemLanguage("es-MX")).toBe("es");
    expect(systemLanguage(undefined)).toBe("en");
  });

  it("prefers the manual choice over the system", () => {
    expect(resolveLanguage("en", "es-ES")).toBe("en");
    expect(resolveLanguage("es", "en-US")).toBe("es");
  });

  it("translates the auto option label", () => {
    expect(translate("en", "settings.languageAuto")).toBe("System (auto)");
    expect(translate("es", "settings.languageAuto")).toBe("Sistema (auto)");
  });
});

describe("translate", () => {
  it("returns English by default", () => {
    expect(translate("en", "header.reload")).toBe("Reload");
    expect(translate("en", "settings.save")).toBe("Save");
  });

  it("returns Spanish when selected", () => {
    expect(translate("es", "header.reload")).toBe("Recargar");
    expect(translate("es", "settings.save")).toBe("Guardar");
  });

  it("falls back to English for unknown languages", () => {
    // @ts-expect-error - unknown runtime value still falls back.
    expect(translate("fr", "header.reload")).toBe("Reload");
  });

  it("every key has a non-empty string in both languages (parity gate)", () => {
    // Key presence is enforced by the Dictionary type; this gate catches
    // the case the type system allows: an empty translation rendering
    // blank UI. A missing ES string would silently fall back to English,
    // so empty is the real regression signal here.
    expect(I18N_KEYS.length).toBeGreaterThan(0);
    for (const key of I18N_KEYS) {
      expect(translate("en", key).trim(), `en:${key}`).not.toBe("");
      expect(translate("es", key).trim(), `es:${key}`).not.toBe("");
    }
  });
});

describe("formatters", () => {
  it("counts projects per language", () => {
    expect(formatGroupCount("en", 1)).toBe("1 project");
    expect(formatGroupCount("en", 3)).toBe("3 projects");
    expect(formatGroupCount("es", 1)).toBe("1 proyecto");
    expect(formatGroupCount("es", 3)).toBe("3 proyectos");
  });

  it("formats the list counter per language", () => {
    // No filter: position / visible is enough (no duplicated total).
    expect(formatCount("en", 1, 10, 10)).toBe("1/10");
    expect(formatCount("es", 1, 10, 10)).toBe("1/10");
    // Filtered: total appended once so no info is lost.
    expect(formatCount("en", 1, 8, 12)).toBe("1/8 of 12");
    expect(formatCount("es", 1, 8, 12)).toBe("1/8 de 12");
  });

  it("labels rows and chrome per language", () => {
    expect(projectAriaLabel("en", "Demo", "Ghostty", "Programs")).toContain("Open Demo");
    expect(projectAriaLabel("es", "Demo", "Ghostty", "Programs")).toContain("Abrir Demo");
    expect(versionAriaLabel("en", "v0.1.0")).toBe("Version v0.1.0");
    expect(versionAriaLabel("es", "v0.1.0")).toBe("Versión v0.1.0");
    expect(removeBaseAriaLabel("en", "/a")).toBe("Remove /a");
    expect(removeBaseAriaLabel("es", "/a")).toBe("Quitar /a");
  });

  it("hints every known terminal in both languages", () => {
    for (const id of ["ghostty", "terminal", "iterm2", "warp", "alacritty", "kitty", "wezterm"]) {
      expect(terminalHint("en", id)).not.toBe("");
      expect(terminalHint("es", id)).not.toBe("");
    }
    expect(terminalHint("en", "unknown")).toBe("");
  });

  it("labels the visibility manager in both languages", () => {
    expect(translate("en", "visibility.title")).not.toBe("");
    expect(translate("es", "visibility.title")).not.toBe("");
    expect(formatVisibilityStatus("en", 5, 7)).toBe("5 of 7 visible");
    expect(formatVisibilityStatus("es", 5, 7)).toBe("5 de 7 visibles");
    expect(visibilityToggleAriaLabel("en", "Demo", false)).toContain("Hide Demo");
    expect(visibilityToggleAriaLabel("en", "Demo", true)).toContain("Show Demo");
    expect(visibilityToggleAriaLabel("es", "Demo", false)).toContain("Ocultar Demo");
    expect(visibilityToggleAriaLabel("es", "Demo", true)).toContain("Mostrar Demo");
  });
});
