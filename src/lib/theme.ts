/** Curated theme ids for the Settings theme picker. */

export type ThemeId =
  | "codedock-dark"
  | "abyss-blue"
  | "ember-dusk"
  | "kelp-night"
  | "orchid-haze"
  | "codedock-light"
  | "harbor-mist"
  | "parchment";

/** Stored theme setting: `"auto"` follows the OS color scheme. */
export type ThemeSetting = ThemeId | "auto";

export type ThemeScheme = "dark" | "light";

/** Default setting: follow the OS color scheme. */
export const DEFAULT_THEME_SETTING: ThemeSetting = "auto";

/** The 8 selectable theme ids, in picker display order (dark first). */
export const THEME_IDS: readonly ThemeId[] = [
  "codedock-dark",
  "abyss-blue",
  "ember-dusk",
  "kelp-night",
  "orchid-haze",
  "codedock-light",
  "harbor-mist",
  "parchment",
];

/** Per-theme metadata: which OS scheme the theme belongs to. */
export const THEME_META: Record<ThemeId, { scheme: ThemeScheme }> = {
  "codedock-dark": { scheme: "dark" },
  "abyss-blue": { scheme: "dark" },
  "ember-dusk": { scheme: "dark" },
  "kelp-night": { scheme: "dark" },
  "orchid-haze": { scheme: "dark" },
  "codedock-light": { scheme: "light" },
  "harbor-mist": { scheme: "light" },
  parchment: { scheme: "light" },
};

function isThemeId(id: string): id is ThemeId {
  return (THEME_IDS as readonly string[]).includes(id);
}

/**
 * Normalizes a stored theme setting from config, UI or localStorage.
 * Missing/empty/`auto` (plus `system`/`default` aliases) -> `"auto"`;
 * any of the 8 locked ids is kept; anything else -> `"auto"`.
 */
export function normalizeThemeSetting(raw: unknown): ThemeSetting {
  if (typeof raw !== "string") return DEFAULT_THEME_SETTING;
  const id = raw.trim().toLowerCase();
  if (id === "" || id === "auto" || id === "system" || id === "default") {
    return "auto";
  }
  if (isThemeId(id)) return id;
  return DEFAULT_THEME_SETTING;
}

/**
 * Resolves the effective theme for a stored setting: an explicit id wins,
 * `"auto"` maps to the default pair (`codedock-dark` / `codedock-light`)
 * from the OS scheme. Pure and easily testable.
 */
export function resolveEffectiveTheme(setting: unknown, prefersLight: boolean): ThemeId {
  const stored = normalizeThemeSetting(setting);
  if (stored !== "auto") return stored;
  return prefersLight ? "codedock-light" : "codedock-dark";
}

/** OS-scheme group of an effective theme (for tints and `color-scheme`). */
export function themeScheme(theme: ThemeId): ThemeScheme {
  return THEME_META[theme]?.scheme ?? "dark";
}

/** i18n key suffix for a theme name (`settings.theme.<id>`). */
export function themeNameKey(theme: ThemeId): `settings.theme.${ThemeId}` {
  return `settings.theme.${theme}`;
}
