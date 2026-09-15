/** A project is a direct subfolder of a base folder. */
export interface Project {
  name: string;
  path: string;
  base: string;
}

/** Normalizes the search: trimmed, case-insensitive. */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * Normalizes a base folder: trims and drops trailing `/` (except root `/`),
 * so `/a` and `/a/` do not duplicate the base. Same rule as the backend.
 */
export function normalizeBaseDir(dir: string): string {
  const trimmed = dir.trim();
  if (trimmed.length > 1) {
    const stripped = trimmed.replace(/\/+$/, "");
    if (stripped !== "") return stripped;
  }
  return trimmed;
}

/**
 * Normalizes a project path for the disabled list: same rule as bases, so
 * `/a/Demo` and `/a/Demo/` count as the same project (mirrors the backend).
 */
export function normalizeProjectPath(path: string): string {
  return normalizeBaseDir(path);
}

/**
 * Cleans a disabled-project list: trims, drops trailing `/`, removes empty
 * and duplicated entries. Stale entries (no longer on disk) are kept: they
 * match nothing and avoid re-enabling a temporarily missing folder.
 */
export function sanitizeDisabledProjects(paths: unknown): string[] {
  if (!Array.isArray(paths)) return [];
  const out: string[] = [];
  for (const item of paths) {
    if (typeof item !== "string") continue;
    const normalized = normalizeProjectPath(item);
    if (normalized === "" || out.includes(normalized)) continue;
    out.push(normalized);
  }
  return out;
}

/** Whether a project path is in the disabled list (hidden everywhere). */
export function isProjectDisabled(projectPath: string, disabled: readonly string[]): boolean {
  const normalized = normalizeProjectPath(projectPath);
  return disabled.some((d) => normalizeProjectPath(d) === normalized);
}

/** Removes disabled projects from a list (does not mutate the input). */
export function applyDisabledFilter(projects: Project[], disabled: readonly string[]): Project[] {
  if (disabled.length === 0) return [...projects];
  return projects.filter((p) => !isProjectDisabled(p.path, disabled));
}

/**
 * Toggles one project in the disabled list: returns a new array.
 * Disabling adds the normalized path; enabling removes it.
 */
export function toggleProjectDisabled(disabled: readonly string[], projectPath: string): string[] {
  const normalized = normalizeProjectPath(projectPath);
  if (normalized === "") return [...disabled];
  if (isProjectDisabled(normalized, disabled)) {
    return disabled.filter((d) => normalizeProjectPath(d) !== normalized);
  }
  return [...disabled, normalized];
}

/** Enables every project: the disabled list becomes empty (prunes stale). */
export function enableAllProjects(): string[] {
  return [];
}

/**
 * Disables every currently known project: returns all their normalized
 * paths (prunes stale entries for ones that no longer exist).
 */
export function disableAllProjects(projects: readonly Project[]): string[] {
  const out: string[] = [];
  for (const p of projects) {
    const normalized = normalizeProjectPath(p.path);
    if (normalized !== "" && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

/** How projects are ordered: global alphabetical or grouped by base folder. */
export type SortMode = "name" | "base";

/**
 * Normalizes the sort mode (config, backend payload or UI).
 * Accepts English/Spanish aliases for the by-base view; anything else
 * falls back to `"name"` so old lists never break.
 */
export function normalizeSortMode(raw: unknown): SortMode {
  if (typeof raw !== "string") return "name";
  switch (raw.trim().toLowerCase()) {
    case "base":
    case "folder":
    case "folders":
    case "carpeta":
    case "carpetas":
    case "base_folder":
    case "by_base":
    case "por_carpeta":
    case "por_carpetas":
      return "base";
    default:
      return "name";
  }
}

/** Short label of a base folder: its last segment. */
export function baseLabel(base: string): string {
  const trimmed = base.trim();
  if (trimmed === "") return base;
  const noSlash = trimmed.replace(/\/+$/, "");
  if (noSlash === "") return "/";
  const cut = noSlash.lastIndexOf("/");
  return cut >= 0 ? noSlash.slice(cut + 1) : noSlash;
}

/**
 * Sorts projects without mutating the original array.
 * - `"name"`: global alphabetical by name (case-insensitive), then path.
 * - `"base"`: by base folder label, then base path, then name.
 */
export function sortProjects(projects: Project[], mode: SortMode): Project[] {
  const out = [...projects];
  if (mode === "base") {
    out.sort((a, b) => {
      const labelCmp = baseLabel(a.base)
        .toLowerCase()
        .localeCompare(baseLabel(b.base).toLowerCase());
      if (labelCmp !== 0) return labelCmp;
      const baseCmp = a.base.toLowerCase().localeCompare(b.base.toLowerCase());
      if (baseCmp !== 0) return baseCmp;
      const nameCmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      if (nameCmp !== 0) return nameCmp;
      if (a.name !== b.name) return a.name < b.name ? -1 : 1;
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    });
  } else {
    out.sort((a, b) => {
      const nameCmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      if (nameCmp !== 0) return nameCmp;
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    });
  }
  return out;
}

/**
 * Filters by name or path (case-insensitive substring).
 * An empty query returns everything in backend order.
 */
export function filterProjects(projects: Project[], query: string): Project[] {
  const q = normalizeQuery(query);
  if (q.length === 0) return [...projects];
  return projects.filter(
    (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q),
  );
}

/**
 * Clamps a selection index to the valid range.
 * Empty list -> -1 (no selection). Out of range -> nearest edge.
 */
export function clampIndex(index: number, length: number): number {
  if (length <= 0) return -1;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}

/**
 * Soft color assigned to a base folder.
 *
 * Style guide (CodeDock dark TUI): the app lives in `color-scheme: dark`
 * on near-black (`--bg #0a0a0b`, `--surface #131315`), elevates via
 * hairline borders and never via shadows, and body text must stay
 * `--text #e4e4e7`. Hence `bg` is only a ~10-12% tint over the surface
 * (the name contrast stays above 12:1, WCAG AAA) and `accent` is a light
 * readable tone on dark backgrounds for dot and badge. The palette stays
 * distinguishable even with red-green color blindness (color is never the
 * only signal: every row also carries its folder text label).
 */
export interface BaseColor {
  /** Row background tint (translucent rgba over the surface). */
  bg: string;
  /** Solid light tone: dot, badge and soft border. */
  accent: string;
  /** Translucent border for row and badge. */
  border: string;
}

/** Fixed 8-tint palette for dark mode (stable, color-blind friendly). */
export const BASE_PALETTE: readonly BaseColor[] = [
  { bg: "rgba(122, 169, 255, 0.11)", accent: "#7aa9ff", border: "rgba(122, 169, 255, 0.38)" },
  { bg: "rgba(111, 211, 198, 0.10)", accent: "#6fd3c6", border: "rgba(111, 211, 198, 0.36)" },
  { bg: "rgba(139, 212, 155, 0.10)", accent: "#8bd49b", border: "rgba(139, 212, 155, 0.36)" },
  { bg: "rgba(232, 195, 126, 0.11)", accent: "#e8c37e", border: "rgba(232, 195, 126, 0.38)" },
  { bg: "rgba(235, 160, 106, 0.11)", accent: "#eba06a", border: "rgba(235, 160, 106, 0.38)" },
  { bg: "rgba(236, 147, 184, 0.11)", accent: "#ec93b8", border: "rgba(236, 147, 184, 0.38)" },
  { bg: "rgba(179, 161, 255, 0.12)", accent: "#b3a1ff", border: "rgba(179, 161, 255, 0.40)" },
  { bg: "rgba(130, 194, 234, 0.11)", accent: "#82c2ea", border: "rgba(130, 194, 234, 0.38)" },
];

/**
 * Fixed 8-tint palette for light mode (opaque hex, never dark rgba).
 * Same slot order as `BASE_PALETTE` so a folder keeps "its" hue across
 * schemes; accents are deep tones readable on near-white surfaces.
 */
export const BASE_PALETTE_LIGHT: readonly BaseColor[] = [
  { bg: "#dfe9fb", accent: "#1f4fae", border: "#a9c1e8" },
  { bg: "#d5f0ea", accent: "#0e6e5f", border: "#9ad3c6" },
  { bg: "#d9f0da", accent: "#1d6b2a", border: "#a3d2a8" },
  { bg: "#f6ecd4", accent: "#7a5410", border: "#dec493" },
  { bg: "#f7e3d3", accent: "#8a3f0e", border: "#e2b48f" },
  { bg: "#f8dfe9", accent: "#9c2350", border: "#e5a9c2" },
  { bg: "#e6e2fb", accent: "#4a3aa8", border: "#bcb2e8" },
  { bg: "#d9edf9", accent: "#0f5a8a", border: "#a2cde8" },
];

/**
 * Stable palette index for a base folder (FNV-1a hash).
 * Deterministic across restarts: adding a folder gives it "its" color
 * without storing anything, and removing others never recolors the rest.
 */
export function baseColorIndex(base: string): number {
  let hash = 2166136261;
  for (let i = 0; i < base.length; i++) {
    hash ^= base.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % BASE_PALETTE.length;
}

/** Soft color of a base folder (same base -> same color, always).
 * Pass `"light"` under a light theme so rows use the opaque light table
 * instead of the dark translucent tints. Defaults to `"dark"` so existing
 * callers keep the historic palette. */
export function baseColorFor(base: string, scheme: "dark" | "light" = "dark"): BaseColor {
  const table = scheme === "light" ? BASE_PALETTE_LIGHT : BASE_PALETTE;
  return table[baseColorIndex(base)] ?? table[0];
}

/** A group of projects from the same base folder ("by folder" view). */
export interface BaseGroup {
  base: string;
  label: string;
  color: BaseColor;
  items: Project[];
}

/**
 * Groups already base-ordered projects, keeping each group arrival order.
 * Only used in `"base"` mode to paint headers.
 */
export function groupProjectsByBase(projects: Project[]): BaseGroup[] {
  const groups: BaseGroup[] = [];
  const seen = new Map<string, BaseGroup>();
  for (const p of projects) {
    let g = seen.get(p.base);
    if (!g) {
      g = { base: p.base, label: baseLabel(p.base), color: baseColorFor(p.base), items: [] };
      seen.set(p.base, g);
      groups.push(g);
    }
    g.items.push(p);
  }
  return groups;
}

/** Filters by `query` and sorts by `mode` (what the list paints). */
export function getVisibleProjects(
  projects: Project[],
  query: string,
  mode: SortMode,
): Project[] {
  return sortProjects(filterProjects(projects, query), mode);
}

/**
 * Moves the selection palette/TUI style (opencode): with wrap-around.
 * Empty list -> -1. `current = -1` + positive delta -> 0.
 */
export function moveSelection(current: number, delta: number, length: number): number {
  if (length <= 0) return -1;
  if (current < 0 || current >= length) return delta >= 0 ? 0 : length - 1;
  return (current + delta + length) % length;
}
