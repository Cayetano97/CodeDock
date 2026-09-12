/** App UI language: English (`en`, the fallback) and Spanish (`es`). */

export type Language = "en" | "es";

/**
 * Stored language setting: `"auto"` follows the system language (the
 * default until the user picks one manually), `"en"`/`"es"` are manual
 * choices that always win.
 */
export type LanguageSetting = Language | "auto";

/** Fallback language: English. */
export const DEFAULT_LANGUAGE: Language = "en";

/** Default setting: follow the system language. */
export const DEFAULT_LANGUAGE_SETTING: LanguageSetting = "auto";

/** Languages offered in Settings, in display order. */
export const SUPPORTED_LANGUAGES: readonly Language[] = ["en", "es"];

/**
 * Normalizes a language tag from config, UI or `navigator.language`.
 * `es*` -> `"es"`, `en*` -> `"en"`, anything else -> `"en"` (fallback).
 * Prefix-based so `es-ES`, `es_MX` or `en-US` resolve to the base language.
 */
export function normalizeLanguage(raw: unknown): Language {
  if (typeof raw !== "string") return DEFAULT_LANGUAGE;
  const id = raw.trim().toLowerCase();
  if (id.startsWith("es")) return "es";
  if (id.startsWith("en")) return "en";
  // Also accept the bare alpha prefix before any separator.
  const base = id.split(/[-_]/, 1)[0];
  if (base === "es") return "es";
  if (base === "en") return "en";
  return DEFAULT_LANGUAGE;
}

/**
 * Normalizes the stored language setting from config or UI.
 * Missing/empty/`auto`/`system`/`default` -> `"auto"` (follow the system);
 * explicit tags resolve via `normalizeLanguage` (`fr` -> `"en"` fallback).
 */
export function normalizeLanguageSetting(raw: unknown): LanguageSetting {
  if (typeof raw !== "string") return DEFAULT_LANGUAGE_SETTING;
  const id = raw.trim().toLowerCase();
  if (id === "" || id === "auto" || id === "system" || id === "default") {
    return "auto";
  }
  return normalizeLanguage(id);
}

/**
 * Effective language for a stored setting: an explicit `"en"`/`"es"` wins,
 * `"auto"` follows `systemTag` (pass `navigator.language` in the window)
 * with an English fallback for missing or unsupported locales. Pure and
 * easily testable.
 */
export function resolveLanguage(setting: unknown, systemTag?: unknown): Language {
  const stored = normalizeLanguageSetting(setting);
  if (stored !== "auto") return stored;
  return normalizeLanguage(typeof systemTag === "string" ? systemTag : undefined);
}

/** System language from a locale tag (e.g. `navigator.language`). */
export function systemLanguage(systemTag?: unknown): Language {
  return normalizeLanguage(typeof systemTag === "string" ? systemTag : undefined);
}

/** Every translatable string key in the window UI. */
export type I18nKey =
  | "app.versionTitle"
  | "header.reload"
  | "header.reloadTitle"
  | "header.quit"
  | "header.quitTitle"
  | "projects.sectionAria"
  | "projects.listAria"
  | "search.placeholder"
  | "search.ariaLabel"
  | "count.noProjects"
  | "empty.noProjects"
  | "empty.noMatches"
  | "bases.title"
  | "bases.sectionAria"
  | "bases.hint"
  | "bases.listAria"
  | "bases.add"
  | "bases.remove"
  | "settings.title"
  | "settings.sectionAria"
  | "settings.terminal"
  | "settings.terminalAria"
  | "settings.sort"
  | "settings.sortAria"
  | "settings.sortByName"
  | "settings.sortByBase"
  | "settings.sortHint"
  | "settings.autostart"
  | "settings.autostartHint"
  | "settings.opencodePath"
  | "settings.opencodePlaceholder"
  | "settings.save"
  | "settings.language"
  | "settings.languageAria"
  | "settings.languageAuto"
  | "settings.theme"
  | "settings.themeAria"
  | "settings.themeAuto"
  | "settings.theme.codedock-dark"
  | "settings.theme.abyss-blue"
  | "settings.theme.ember-dusk"
  | "settings.theme.kelp-night"
  | "settings.theme.orchid-haze"
  | "settings.theme.codedock-light"
  | "settings.theme.harbor-mist"
  | "settings.theme.parchment"
  | "statusbar.navigate"
  | "statusbar.open"
  | "statusbar.filter"
  | "statusbar.clear"
  | "dialog.chooseBase"
  | "terminal.notInstalled";

type Dictionary = Record<I18nKey, string>;

/** English strings (canonical fallback). */
const EN: Dictionary = {
  "app.versionTitle": "CodeDock version",
  "header.reload": "Reload",
  "header.reloadTitle": "Rescan the base folders (r)",
  "header.quit": "Quit",
  "header.quitTitle": "Quit CodeDock",
  "projects.sectionAria": "Projects",
  "projects.listAria": "Projects",
  "search.placeholder": "filter projects…  ( / to focus )",
  "search.ariaLabel": "Filter projects",
  "count.noProjects": "— no projects —",
  "empty.noProjects": "No projects: add a base folder below.",
  "empty.noMatches": "No matches.",
  "bases.title": "Base folders",
  "bases.sectionAria": "Base folders",
  "bases.hint": "Each direct subfolder shows up as a project.",
  "bases.listAria": "Base folders",
  "bases.add": "+ add folder…",
  "bases.remove": "remove",
  "settings.title": "Settings",
  "settings.sectionAria": "Settings",
  "settings.terminal": "Terminal",
  "settings.terminalAria": "Terminal to open projects in",
  "settings.sort": "Sort projects",
  "settings.sortAria": "How to sort projects",
  "settings.sortByName": "By name",
  "settings.sortByBase": "By base folder",
  "settings.sortHint": "By folder groups with each base header and color.",
  "settings.autostart": "Launch at login",
  "settings.autostartHint": "Off: start CodeDock by hand.",
  "settings.opencodePath": "opencode path (empty = auto-detect)",
  "settings.opencodePlaceholder": "~/.opencode/bin/opencode",
  "settings.save": "Save",
  "settings.language": "Language",
  "settings.languageAria": "Interface language",
  "settings.languageAuto": "System (auto)",
  "settings.theme": "Theme",
  "settings.themeAria": "Color theme",
  "settings.themeAuto": "System (auto)",
  "settings.theme.codedock-dark": "CodeDock dark",
  "settings.theme.abyss-blue": "Abyss blue",
  "settings.theme.ember-dusk": "Ember dusk",
  "settings.theme.kelp-night": "Kelp night",
  "settings.theme.orchid-haze": "Orchid haze",
  "settings.theme.codedock-light": "CodeDock light",
  "settings.theme.harbor-mist": "Harbor mist",
  "settings.theme.parchment": "Parchment",
  "statusbar.navigate": "navigate",
  "statusbar.open": "open",
  "statusbar.filter": "filter",
  "statusbar.clear": "clear",
  "dialog.chooseBase": "Choose base folder",
  "terminal.notInstalled": "(not installed)",
};

/** Spanish strings. Missing keys fall back to English at runtime. */
const ES: Dictionary = {
  "app.versionTitle": "Versión de CodeDock",
  "header.reload": "Recargar",
  "header.reloadTitle": "Volver a escanear las carpetas base (r)",
  "header.quit": "Salir",
  "header.quitTitle": "Salir de CodeDock",
  "projects.sectionAria": "Proyectos",
  "projects.listAria": "Proyectos",
  "search.placeholder": "filtrar proyectos…  ( / para enfocar )",
  "search.ariaLabel": "Filtrar proyectos",
  "count.noProjects": "— sin proyectos —",
  "empty.noProjects": "Sin proyectos: añade una carpeta base abajo.",
  "empty.noMatches": "Sin coincidencias.",
  "bases.title": "Carpetas base",
  "bases.sectionAria": "Carpetas base",
  "bases.hint": "Cada subcarpeta directa aparece como proyecto.",
  "bases.listAria": "Carpetas base",
  "bases.add": "+ añadir carpeta…",
  "bases.remove": "quitar",
  "settings.title": "Ajustes",
  "settings.sectionAria": "Ajustes",
  "settings.terminal": "Terminal",
  "settings.terminalAria": "Terminal donde abrir los proyectos",
  "settings.sort": "Ordenar proyectos",
  "settings.sortAria": "Cómo ordenar los proyectos",
  "settings.sortByName": "Por nombre",
  "settings.sortByBase": "Por carpeta base",
  "settings.sortHint": "Por carpeta agrupa con cabecera y color de cada base.",
  "settings.autostart": "Abrir al iniciar sesión",
  "settings.autostartHint": "Apagado: arranca CodeDock a mano.",
  "settings.opencodePath": "Ruta de opencode (vacío = detectar solo)",
  "settings.opencodePlaceholder": "~/.opencode/bin/opencode",
  "settings.save": "Guardar",
  "settings.language": "Idioma",
  "settings.languageAria": "Idioma de la interfaz",
  "settings.languageAuto": "Sistema (auto)",
  "settings.theme": "Tema",
  "settings.themeAria": "Tema de color",
  "settings.themeAuto": "Sistema (auto)",
  "settings.theme.codedock-dark": "CodeDock oscuro",
  "settings.theme.abyss-blue": "Azul abisal",
  "settings.theme.ember-dusk": "Brasa del ocaso",
  "settings.theme.kelp-night": "Noche kelp",
  "settings.theme.orchid-haze": "Niebla orquídea",
  "settings.theme.codedock-light": "CodeDock claro",
  "settings.theme.harbor-mist": "Niebla del puerto",
  "settings.theme.parchment": "Pergamino",
  "statusbar.navigate": "navegar",
  "statusbar.open": "abrir",
  "statusbar.filter": "filtrar",
  "statusbar.clear": "limpiar",
  "dialog.chooseBase": "Elige carpeta base",
  "terminal.notInstalled": "(no instalado)",
};

const STRINGS: Record<Language, Dictionary> = { en: EN, es: ES };

/** Every translatable key (enumerable at runtime for the parity gate). */
export const I18N_KEYS: readonly I18nKey[] = Object.keys(EN) as I18nKey[];

/**
 * Translates a key for `lang`, falling back to English and then to the key.
 * Pure and easily testable; the active language lives in `main.ts`.
 */
export function translate(lang: Language, key: I18nKey): string {
  const normalized = normalizeLanguage(lang);
  return STRINGS[normalized][key] ?? EN[key] ?? key;
}

/** Per-terminal behavior hint shown under the picker. */
const TERMINAL_HINTS_EN: Record<string, string> = {
  ghostty: "New tab if Ghostty is open; otherwise a new window.",
  terminal: "Terminal.app always opens a new window (it has no tab API).",
  iterm2: "New tab if iTerm2 is open; otherwise a new window.",
  warp: "Warp only opens the folder in a tab: run opencode by hand (its API cannot launch commands).",
  alacritty: "Alacritty has no tabs: always opens a new window.",
  kitty: "Kitty opens a new OS window (tabs need remote control in kitty.conf).",
  wezterm: "New tab if WezTerm is open; otherwise a new window.",
};

/** Spanish per-terminal behavior hint. */
const TERMINAL_HINTS_ES: Record<string, string> = {
  ghostty: "Pestaña nueva si Ghostty está abierto; si no, ventana nueva.",
  terminal: "Terminal.app siempre abre ventana nueva (no sabe abrir pestañas).",
  iterm2: "Pestaña nueva si iTerm2 está abierto; si no, ventana nueva.",
  warp: "Warp solo abre la carpeta en una pestaña: ejecuta opencode a mano (su API no permite lanzar comandos).",
  alacritty: "Alacritty no tiene pestañas: siempre abre ventana nueva.",
  kitty: "Kitty abre una ventana de SO nueva (las pestañas requieren control remoto en kitty.conf).",
  wezterm: "Pestaña nueva si WezTerm está abierto; si no, ventana nueva.",
};

/** Behavior hint for a terminal id, with English fallback. */
export function terminalHint(lang: Language, terminalId: string): string {
  const normalized = normalizeLanguage(lang);
  const table = normalized === "es" ? TERMINAL_HINTS_ES : TERMINAL_HINTS_EN;
  return table[terminalId] ?? TERMINAL_HINTS_EN[terminalId] ?? "";
}

/** `1 project` / `N projects` group counter. */
export function formatGroupCount(lang: Language, count: number): string {
  if (normalizeLanguage(lang) === "es") {
    return count === 1 ? "1 proyecto" : `${String(count)} proyectos`;
  }
  return count === 1 ? "1 project" : `${String(count)} projects`;
}

/** `3/10` project counter (position / visible). When a filter hides
 * projects, the total is appended once: `1/8 of 12` / `1/8 de 12`.
 * This avoids the old duplicated `1/10 · 10 of 10` form. */
export function formatCount(
  lang: Language,
  selected: number,
  visible: number,
  total: number,
): string {
  const pos = `${String(selected)}/${String(visible)}`;
  if (visible === total) return pos;
  const of = normalizeLanguage(lang) === "es" ? "de" : "of";
  return `${pos} ${of} ${String(total)}`;
}

/** Accessible label of a project row button. */
export function projectAriaLabel(
  lang: Language,
  name: string,
  terminalName: string,
  baseLabel: string,
): string {
  if (normalizeLanguage(lang) === "es") {
    return `Abrir ${name} en ${terminalName} con opencode (carpeta ${baseLabel})`;
  }
  return `Open ${name} in ${terminalName} with opencode (folder ${baseLabel})`;
}

/** Accessible label of the version (statusbar only; the header badge
 * was removed to avoid showing the version twice). Kept exported for tests. */
export function versionAriaLabel(lang: Language, version: string): string {
  if (normalizeLanguage(lang) === "es") {
    return `Versión ${version}`;
  }
  return `Version ${version}`;
}

/** Accessible label of a base-folder remove button. */
export function removeBaseAriaLabel(lang: Language, dir: string): string {
  if (normalizeLanguage(lang) === "es") {
    return `Quitar ${dir}`;
  }
  return `Remove ${dir}`;
}
