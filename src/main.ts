import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { open } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  formatCount,
  formatGroupCount,
  normalizeLanguageSetting,
  projectAriaLabel,
  removeBaseAriaLabel,
  resolveLanguage,
  terminalHint,
  translate,
  type I18nKey,
  type Language,
  type LanguageSetting,
} from "./lib/i18n";
import {
  baseColorFor,
  baseLabel,
  clampIndex,
  getVisibleProjects,
  moveSelection,
  normalizeBaseDir,
  normalizeSortMode,
  type Project,
  type SortMode,
} from "./lib/model";
import {
  normalizeThemeSetting,
  resolveEffectiveTheme,
  themeNameKey,
  themeScheme,
  THEME_IDS,
  type ThemeId,
  type ThemeSetting,
} from "./lib/theme";
import { formatVersion, getAppVersion } from "./lib/version";
import {
  BACKDROP_DISMISS_DECISION,
  CLOSE_DISMISS_DECISION,
  createUpdateScheduler,
  ESC_DISMISS_DECISION,
  fillUpdateTemplate,
  getDismissedVersion,
  getNextOpenVersion,
  recordPromptDecision,
  shouldAutoInstallOnStart,
  shouldDeferForPanels,
  shouldOfferUpdate,
  UPDATE_MIN_CHECK_INTERVAL_MS,
  UPDATE_PERIODIC_CHECK_INTERVAL_MS,
} from "./lib/update";

/** Re-exported so triggers stay observable/testable from the entry point. */
export { UPDATE_MIN_CHECK_INTERVAL_MS, UPDATE_PERIODIC_CHECK_INTERVAL_MS };

interface Config {
  baseDirs: string[];
  opencodeBin: string | null;
  terminal: string;
  sortMode: SortMode;
  language: LanguageSetting;
  theme: ThemeSetting;
}

interface TerminalInfo {
  id: string;
  name: string;
  available: boolean;
}

let config: Config = {
  baseDirs: [],
  opencodeBin: null,
  terminal: "ghostty",
  sortMode: "name",
  language: "auto",
  theme: "auto",
};

let lang: Language = "en";
let languageSetting: LanguageSetting = "auto";
let themeSetting: ThemeSetting = "auto";
let effectiveTheme: ThemeId = "codedock-dark";
let terminals: TerminalInfo[] = [];
let projects: Project[] = [];
let visible: Project[] = [];
let selected = -1;
let errorTimer = 0;
// OS login-item state (source of truth, like QuickSpot): not stored in
// `codedock.config.json`, read via `isEnabled()` and applied via
// `enable()` / `disable()`.
let autostartEnabled = false;

const search = document.querySelector<HTMLInputElement>("#search")!;
const count = document.querySelector<HTMLElement>("#count")!;
const list = document.querySelector<HTMLElement>("#projects")!;
const empty = document.querySelector<HTMLElement>("#empty")!;
const bases = document.querySelector<HTMLElement>("#bases")!;
const addBase = document.querySelector<HTMLButtonElement>("#add-base")!;
const autostartToggle = document.querySelector<HTMLInputElement>("#autostart")!;
const terminalSelect = document.querySelector<HTMLSelectElement>("#terminal")!;
const terminalHintEl = document.querySelector<HTMLElement>("#terminal-hint")!;
const sortSelect = document.querySelector<HTMLSelectElement>("#sort-mode")!;
const themeSelect = document.querySelector<HTMLSelectElement>("#theme")!;
const languageSelect = document.querySelector<HTMLSelectElement>("#language")!;
const opencodeBin = document.querySelector<HTMLInputElement>("#opencode-bin")!;
const save = document.querySelector<HTMLButtonElement>("#save")!;
const reload = document.querySelector<HTMLButtonElement>("#reload")!;
const quit = document.querySelector<HTMLButtonElement>("#quit")!;
const errorLine = document.querySelector<HTMLElement>("#error")!;
const statusbarVersion = document.querySelector<HTMLElement>("#statusbar-version")!;

// Update UI (nullable: the popup/row are progressive enhancement over the
// base window; every access guards so a missing node never breaks boot).
const updateBackdrop = document.querySelector<HTMLElement>("#update-backdrop");
const updatePopup = document.querySelector<HTMLElement>("#update-popup");
const updateTitle = document.querySelector<HTMLElement>("#update-title");
const updateMessage = document.querySelector<HTMLElement>("#update-message");
const updateProgress = document.querySelector<HTMLElement>("#update-progress");
const updateProgressBar = document.querySelector<HTMLElement>("#update-progress-bar");
const updateProgressTrack = document.querySelector<HTMLElement>("#update-progress-track");
const updateProgressLabel = document.querySelector<HTMLElement>("#update-progress-label");
const updateError = document.querySelector<HTMLElement>("#update-error");
const updateNowBtn = document.querySelector<HTMLButtonElement>("#update-now");
const updateLaterBtn = document.querySelector<HTMLButtonElement>("#update-later");
const updateNextOpenBtn = document.querySelector<HTMLButtonElement>("#update-next-open");
const updateCloseBtn = document.querySelector<HTMLButtonElement>("#update-close");
const checkUpdatesBtn = document.querySelector<HTMLButtonElement>("#check-updates");
const updateStatus = document.querySelector<HTMLElement>("#update-status");
const updateLabel = document.querySelector<HTMLElement>("#update-label");

/** Shortcut for the active language. */
function t(key: I18nKey): string {
  return translate(lang, key);
}

/** System locale tag (`navigator.language`), empty when unavailable. */
function systemTag(): string {
  try {
    const tag =
      typeof navigator !== "undefined" ? navigator.language : "";
    return typeof tag === "string" ? tag : "";
  } catch {
    return "";
  }
}

/**
 * Applies a stored language setting: an explicit `"en"`/`"es"` wins, `"auto"`
 * follows the system language with an English fallback.
 */
function applyLanguageSetting(setting: unknown): void {
  languageSetting = normalizeLanguageSetting(setting);
  config.language = languageSetting;
  lang = resolveLanguage(languageSetting, systemTag());
}

/** Whether the OS currently prefers a light color scheme. */
function prefersLightScheme(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: light)").matches
    );
  } catch {
    return false;
  }
}

/**
 * Applies a stored theme setting: an explicit id wins, `"auto"` follows the
 * OS scheme through the default pair. Swaps `<html data-theme>` (instant, no
 * reload), syncs the `color-scheme` meta so scrollbars and form controls
 * match, and mirrors the setting to localStorage for the pre-paint boot
 * snippet. Pure DOM side effects; persistence goes through `saveAll`.
 */
function applyThemeSetting(setting: unknown): void {
  themeSetting = normalizeThemeSetting(setting);
  config.theme = themeSetting;
  effectiveTheme = resolveEffectiveTheme(themeSetting, prefersLightScheme());
  document.documentElement.setAttribute("data-theme", effectiveTheme);
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (meta) meta.content = themeScheme(effectiveTheme);
  try {
    localStorage.setItem("codedock-theme", themeSetting);
  } catch {
    // Private mode or no storage: boot simply falls back to dark.
  }
}

/**
 * Applies the active language to every static label in the window.
 * Dynamic lists (projects, bases, terminal options) are re-rendered by
 * their own functions right after.
 */
function applyI18n(): void {
  document.documentElement.lang = lang;
  document.querySelector("#section-projects")?.setAttribute("aria-label", t("projects.sectionAria"));
  document.querySelector("#panel-bases")?.setAttribute("aria-label", t("bases.sectionAria"));
  document.querySelector("#panel-settings")?.setAttribute("aria-label", t("settings.sectionAria"));

  const setText = (selector: string, key: I18nKey): void => {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) el.textContent = t(key);
  };
  setText("#bases-title", "bases.title");
  setText("#bases-hint", "bases.hint");
  setText("#add-base", "bases.add");
  setText("#settings-title", "settings.title");
  setText("#language-label", "settings.language");
  setText("#theme-label", "settings.theme");
  setText("#terminal-label", "settings.terminal");
  setText("#sort-label", "settings.sort");
  setText("#sort-hint", "settings.sortHint");
  setText("#autostart-label", "settings.autostart");
  setText("#autostart-hint", "settings.autostartHint");
  setText("#opencode-label", "settings.opencodePath");
  setText("#save", "settings.save");

  const reloadBtn = document.querySelector<HTMLButtonElement>("#reload");
  if (reloadBtn) {
    reloadBtn.textContent = t("header.reload");
    reloadBtn.title = t("header.reloadTitle");
  }
  const quitBtn = document.querySelector<HTMLButtonElement>("#quit");
  if (quitBtn) {
    quitBtn.textContent = t("header.quit");
    quitBtn.title = t("header.quitTitle");
  }

  search.placeholder = t("search.placeholder");
  search.setAttribute("aria-label", t("search.ariaLabel"));
  list.setAttribute("aria-label", t("projects.listAria"));
  bases.setAttribute("aria-label", t("bases.listAria"));
  terminalSelect.setAttribute("aria-label", t("settings.terminalAria"));
  sortSelect.setAttribute("aria-label", t("settings.sortAria"));
  languageSelect.setAttribute("aria-label", t("settings.languageAria"));
  autostartToggle.setAttribute("aria-label", t("settings.autostart"));
  opencodeBin.placeholder = t("settings.opencodePlaceholder");

  // Sort option labels (values stay stable: "name" / "base").
  const nameOpt = sortSelect.querySelector('option[value="name"]');
  if (nameOpt) nameOpt.textContent = t("settings.sortByName");
  const baseOpt = sortSelect.querySelector('option[value="base"]');
  if (baseOpt) baseOpt.textContent = t("settings.sortByBase");

  // Language options: "auto" follows the system, "en"/"es" are manual.
  const autoOpt = languageSelect.querySelector('option[value="auto"]');
  if (autoOpt) autoOpt.textContent = t("settings.languageAuto");

  // Theme options: "auto" follows the OS scheme, the rest are curated ids.
  themeSelect.setAttribute("aria-label", t("settings.themeAria"));
  const themeAutoOpt = themeSelect.querySelector('option[value="auto"]');
  if (themeAutoOpt) themeAutoOpt.textContent = t("settings.themeAuto");
  for (const id of THEME_IDS) {
    const opt = themeSelect.querySelector(`option[value="${id}"]`);
    if (opt) opt.textContent = t(themeNameKey(id));
  }

  // Statusbar keeps its <kbd> chips; only the trailing word is translated.
  const navigate = document.querySelector<HTMLElement>("#st-navigate");
  if (navigate) navigate.innerHTML = "<kbd>↑↓</kbd>/<kbd>j k</kbd>" + t("statusbar.navigate");
  const openEl = document.querySelector<HTMLElement>("#st-open");
  if (openEl) openEl.innerHTML = "<kbd>⏎</kbd>" + t("statusbar.open");
  const filter = document.querySelector<HTMLElement>("#st-filter");
  if (filter) filter.innerHTML = "<kbd>/</kbd>" + t("statusbar.filter");
  const clear = document.querySelector<HTMLElement>("#st-clear");
  if (clear) clear.innerHTML = "<kbd>esc</kbd>" + t("statusbar.clear");

  // Update checker row + popup (progress/error slots keep their state and
  // are only re-labeled when idle).
  if (updateLabel) updateLabel.textContent = t("update.checkNow");
  if (checkUpdatesBtn) checkUpdatesBtn.textContent = t("update.checkNow");
  if (updateTitle) updateTitle.textContent = t("update.title");
  if (updateNowBtn) updateNowBtn.textContent = t("update.now");
  if (updateLaterBtn) updateLaterBtn.textContent = t("update.later");
  if (updateNextOpenBtn) updateNextOpenBtn.textContent = t("update.nextOpen");
  if (pendingUpdateVersion !== null && !updateDownloading) {
    paintUpdateMessage(pendingUpdateVersion);
  }
}

/**
 * Paints the version in the statusbar only (single source of truth)
 * without blocking boot: `getAppVersion` reads Tauri at runtime with a
 * build-time fallback, never hardcoded. Decorative: on failure the
 * statusbar slot stays empty and hidden via CSS (`:empty`).
 */
async function showVersion(): Promise<void> {
  try {
    const text = formatVersion(await getAppVersion());
    if (text === "") return;
    statusbarVersion.textContent = text;
  } catch {
    // The app works the same without a visible version.
  }
}

// ── in-app updates ──────────────────────────────────────────────
// Prompt-first via the updater + process plugins: check on start, on
// window-show (5-minute throttle) and every 6 hours while running, plus a
// manual Settings check that bypasses the throttle. Every path degrades
// silently outside a packaged build (dev/browser `check()` throws and is
// swallowed; only the manual row surfaces an inline state).

/** Minimal structural view of the plugin `Update` (test-mock friendly). */
interface UpdateHandle {
  version: string;
  currentVersion: string;
  downloadAndInstall: (
    onEvent?: (event: {
      event: "Started" | "Progress" | "Finished";
      data?: { contentLength?: number; chunkLength?: number };
    }) => void,
  ) => Promise<void>;
}

let pendingUpdateVersion: string | null = null;
let pendingUpdateHandle: UpdateHandle | null = null;
let deferredUpdateHandle: UpdateHandle | null = null;
let updateDownloading = false;
// True after a login (hidden) start until the first manual show: automatic
// checks stay dormant so no update modal pops over the login session. The
// Settings manual check bypasses this gate.
let updatesPausedForAutostart = false;
const updateScheduler = createUpdateScheduler();

/** localStorage or null (private mode never breaks the checker). */
function safeStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function setUpdateStatus(msg: string): void {
  if (updateStatus) updateStatus.textContent = msg;
}

function paintUpdateMessage(version: string): void {
  if (updateMessage) {
    updateMessage.textContent = fillUpdateTemplate(t("update.message"), { version });
  }
}

function paintUpdateProgress(percent: number): void {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  if (updateProgressBar) updateProgressBar.style.width = `${String(clamped)}%`;
  if (updateProgressTrack) updateProgressTrack.setAttribute("aria-valuenow", String(clamped));
  if (updateProgressLabel) {
    updateProgressLabel.textContent = fillUpdateTemplate(t("update.progress"), {
      percent: clamped,
    });
  }
}

function setUpdateControlsLocked(locked: boolean): void {
  for (const btn of [updateNowBtn, updateLaterBtn, updateNextOpenBtn, updateCloseBtn]) {
    if (btn) btn.disabled = locked;
  }
}

/**
 * Whether the prompt must stay hidden right now. CodeDock panels are always
 * laid out (no modal panels), so "open" means the user is working inside
 * Settings (`#panel-settings`) or the folder Actions panel (`#panel-bases`,
 * add/remove folder): focus inside either defers the prompt until close.
 */
function updatePanelState(): { settingsOpen: boolean; actionsOpen: boolean } {
  try {
    const active = document.activeElement as HTMLElement | null;
    return {
      settingsOpen: Boolean(active?.closest?.("#panel-settings")),
      actionsOpen: Boolean(active?.closest?.("#panel-bases")),
    };
  } catch {
    return { settingsOpen: false, actionsOpen: false };
  }
}

function showUpdateModal(version: string, handle: UpdateHandle): void {
  pendingUpdateVersion = version;
  pendingUpdateHandle = handle;
  if (updateTitle) updateTitle.textContent = t("update.title");
  paintUpdateMessage(version);
  if (updateNowBtn) updateNowBtn.textContent = t("update.now");
  if (updateLaterBtn) updateLaterBtn.textContent = t("update.later");
  if (updateNextOpenBtn) updateNextOpenBtn.textContent = t("update.nextOpen");
  if (updateError) updateError.textContent = "";
  if (updateProgress) updateProgress.hidden = true;
  paintUpdateProgress(0);
  updateDownloading = false;
  setUpdateControlsLocked(false);
  if (updateBackdrop) updateBackdrop.hidden = false;
  if (updatePopup) updatePopup.hidden = false;
  // Focus starts on the primary action per spec.
  try {
    updateNowBtn?.focus();
  } catch {
    // Focus is best-effort: the prompt stays usable without it.
  }
}

function hideUpdateModal(): void {
  if (updateBackdrop) updateBackdrop.hidden = true;
  if (updatePopup) updatePopup.hidden = true;
  pendingUpdateVersion = null;
  pendingUpdateHandle = null;
}

/** Later / On-next-open / Esc / close / backdrop all funnel through here. */
function dismissUpdateAs(decision: "later" | "next-open"): void {
  const version = pendingUpdateVersion;
  if (version !== null) recordPromptDecision(version, decision, safeStorage());
  hideUpdateModal();
}

/** Update now: download with progress %, install, relaunch. */
async function installPendingUpdate(): Promise<void> {
  const handle = pendingUpdateHandle;
  const version = pendingUpdateVersion;
  if (!handle || version === null || updateDownloading) return;
  updateDownloading = true;
  setUpdateControlsLocked(true);
  if (updateProgress) updateProgress.hidden = false;
  if (updateError) updateError.textContent = "";
  paintUpdateProgress(0);
  let total: number | undefined;
  let received = 0;
  try {
    await handle.downloadAndInstall((event) => {
      try {
        if (event.event === "Started") {
          if (typeof event.data?.contentLength === "number") total = event.data.contentLength;
          paintUpdateProgress(0);
        } else if (event.event === "Progress") {
          received += event.data?.chunkLength ?? 0;
          paintUpdateProgress(total !== undefined && total > 0 ? (received / total) * 100 : 0);
        } else {
          paintUpdateProgress(100);
        }
      } catch {
        // Progress paint never fails the install.
      }
    });
    recordPromptDecision(version, "now", safeStorage());
    await relaunch();
  } catch (e) {
    // Recoverable: the prompt stays usable for a retry or a postpone.
    if (updateError) {
      const detail = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
      updateError.textContent =
        detail !== "" ? `${t("update.installError")}: ${detail}` : t("update.installError");
    }
    updateDownloading = false;
    setUpdateControlsLocked(false);
  }
}

/**
 * Automatic check (throttled) or manual Settings check (bypasses the
 * throttle). Returns the found update or null. Silent unless manual.
 */
async function checkForUpdates(opts: { manual?: boolean } = {}): Promise<unknown> {
  const manual = opts.manual === true;
  try {
    if (!manual && updatesPausedForAutostart) return null;
    if (!manual && !updateScheduler.canCheckNow()) return null;
    const found = (await check()) as unknown as UpdateHandle | null;
    updateScheduler.markChecked();
    if (!found || typeof found.version !== "string" || found.version.trim() === "") {
      if (manual) setUpdateStatus(t("update.upToDate"));
      return null;
    }
    const available = found.version.trim();
    let current = "";
    try {
      current = await getAppVersion();
    } catch {
      current = "";
    }
    if (current.trim() === "") current = found.currentVersion ?? "";
    const storage = safeStorage();
    const nextOpen = getNextOpenVersion(storage);
    // On-next-open persists across restarts: auto-install, no re-prompt.
    if (shouldAutoInstallOnStart(available, nextOpen)) {
      pendingUpdateVersion = available;
      pendingUpdateHandle = found;
      await installPendingUpdate();
      return found;
    }
    if (
      !shouldOfferUpdate(available, current, {
        dismissedVersion: getDismissedVersion(),
        nextOpenVersion: nextOpen,
      })
    ) {
      return null;
    }
    // Suppressed while Settings/Actions are open; re-offered on close.
    if (shouldDeferForPanels(updatePanelState())) {
      deferredUpdateHandle = found;
      return null;
    }
    showUpdateModal(available, found);
    return found;
  } catch {
    // Silent dev-degrade: only the manual row surfaces an inline state.
    if (manual) setUpdateStatus(t("update.checkError"));
    return null;
  }
}

/** Settings "Check for updates": bypasses the 5-minute throttle. */
export async function checkForUpdatesManual(): Promise<void> {
  await checkForUpdates({ manual: true });
}

/** Re-offers a panel-deferred prompt once suppression clears. */
function maybeReofferDeferredUpdate(): void {
  if (!deferredUpdateHandle || pendingUpdateHandle || updateDownloading) return;
  if (shouldDeferForPanels(updatePanelState())) return;
  const handle = deferredUpdateHandle;
  deferredUpdateHandle = null;
  try {
    showUpdateModal(handle.version, handle);
  } catch {
    // A failed re-offer simply retries on the next trigger.
    deferredUpdateHandle = handle;
  }
}

/** Wires modal gestures + Settings row once (idempotent). */
let updateEventsWired = false;
function wireUpdateEvents(): void {
  if (updateEventsWired) return;
  updateEventsWired = true;
  try {
    updateNowBtn?.addEventListener("click", () => {
      void installPendingUpdate();
    });
    updateLaterBtn?.addEventListener("click", () => {
      if (updateDownloading) return;
      dismissUpdateAs("later");
    });
    updateNextOpenBtn?.addEventListener("click", () => {
      if (updateDownloading) return;
      dismissUpdateAs("next-open");
    });
    // Esc, the close button and the backdrop all behave as Later.
    updateCloseBtn?.addEventListener("click", () => {
      if (updateDownloading) return;
      if (pendingUpdateVersion !== null) {
        recordPromptDecision(pendingUpdateVersion, CLOSE_DISMISS_DECISION, safeStorage());
      }
      hideUpdateModal();
    });
    updateBackdrop?.addEventListener("click", (e) => {
      if (e.target !== updateBackdrop || updateDownloading) return;
      if (pendingUpdateVersion !== null) {
        recordPromptDecision(pendingUpdateVersion, BACKDROP_DISMISS_DECISION, safeStorage());
      }
      hideUpdateModal();
    });
    updatePopup?.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !updateDownloading) {
        e.preventDefault();
        if (pendingUpdateVersion !== null) {
          recordPromptDecision(pendingUpdateVersion, ESC_DISMISS_DECISION, safeStorage());
        }
        hideUpdateModal();
      }
    });
    checkUpdatesBtn?.addEventListener("click", () => {
      setUpdateStatus("");
      void checkForUpdatesManual();
    });
    // Re-offer a deferred prompt when the panels close.
    document.addEventListener("focusout", () => {
      window.setTimeout(maybeReofferDeferredUpdate, 0);
    });
  } catch {
    // Update wiring never breaks the base window.
  }
}

function showError(msg: string): void {
  errorLine.textContent = msg;
  window.clearTimeout(errorTimer);
  errorTimer = window.setTimeout(() => {
    errorLine.textContent = "";
  }, 6000);
}

function terminalName(): string {
  return terminals.find((t) => t.id === config.terminal)?.name ?? config.terminal;
}

function syncTerminalHint(): void {
  terminalHintEl.textContent = terminalHint(lang, config.terminal);
}

function renderTerminalOptions(): void {
  terminalSelect.replaceChildren();
  for (const term of terminals) {
    const opt = document.createElement("option");
    opt.value = term.id;
    opt.textContent = term.available ? term.name : `${term.name} ${t("terminal.notInstalled")}`;
    terminalSelect.appendChild(opt);
  }
  // The backend normalizes: the stored value is always a known id.
  terminalSelect.value = config.terminal;
  syncTerminalHint();
}

function scrollSelectedIntoView(): void {
  const el = list.querySelector<HTMLElement>("li.selected");
  el?.scrollIntoView({ block: "nearest" });
}

function paintBaseTint(el: HTMLElement, base: string): void {
  // Deterministic soft tint per folder: same base -> same color on
  // projects, group headers and the base list (legend). Under a light
  // theme the opaque light table replaces the dark translucent tints.
  const color = baseColorFor(base, themeScheme(effectiveTheme));
  el.style.setProperty("--base-bg", color.bg);
  el.style.setProperty("--base-accent", color.accent);
  el.style.setProperty("--base-border", color.border);
}

function renderProjects(): void {
  const prevPath = visible[selected]?.path;
  visible = getVisibleProjects(projects, search.value, config.sortMode);

  // Keep the selection when the project is still visible; else the first one.
  if (visible.length === 0) {
    selected = -1;
  } else {
    const kept = prevPath ? visible.findIndex((p) => p.path === prevPath) : -1;
    selected = kept >= 0 ? kept : clampIndex(selected, visible.length);
    if (selected < 0) selected = 0;
  }

  list.replaceChildren();
  const grouped = config.sortMode === "base";
  let lastBase: string | null = null;
  visible.forEach((p, i) => {
    // In by-folder view, a group header with label + count.
    // The text label also identifies the folder for color-blind users
    // and screen readers (color is never the only signal).
    if (grouped && p.base !== lastBase) {
      lastBase = p.base;
      const groupCount = visible.filter((v) => v.base === p.base).length;
      const header = document.createElement("li");
      header.className = "group-header";
      header.setAttribute("role", "presentation");
      paintBaseTint(header, p.base);
      const label = document.createElement("span");
      label.className = "group-label";
      label.textContent = baseLabel(p.base);
      label.title = p.base;
      const meta = document.createElement("span");
      meta.className = "group-count";
      meta.textContent = formatGroupCount(lang, groupCount);
      header.append(label, meta);
      list.appendChild(header);
    }
    const li = document.createElement("li");
    li.dataset.base = p.base;
    if (i === selected) li.className = "selected";
    paintBaseTint(li, p.base);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = `proj-${i}`;
    btn.setAttribute("role", "option");
    btn.setAttribute("aria-selected", i === selected ? "true" : "false");
    const name = document.createElement("span");
    name.className = "proj-name";
    name.textContent = p.name;
    const path = document.createElement("span");
    path.className = "proj-path";
    path.textContent = p.path;
    btn.append(name, path);
    btn.setAttribute(
      "aria-label",
      projectAriaLabel(lang, p.name, terminalName(), baseLabel(p.base)),
    );
    btn.addEventListener("click", () => void openProject(p.path));
    btn.addEventListener("mousemove", () => {
      if (selected !== i) {
        selected = i;
        syncSelection();
      }
    });
    li.appendChild(btn);
    list.appendChild(li);
  });

  search.setAttribute(
    "aria-activedescendant",
    selected >= 0 ? `proj-${String(selected)}` : "",
  );
  count.textContent =
    projects.length === 0
      ? t("count.noProjects")
      : formatCount(lang, selected + 1, visible.length, projects.length);
  empty.textContent =
    projects.length === 0
      ? t("empty.noProjects")
      : visible.length === 0
        ? t("empty.noMatches")
        : "";
}

function syncSelection(): void {
  // Only project rows (`li[data-base]`): group headers
  // (`li.group-header`) are not selectable and do not count for the index.
  const items = list.querySelectorAll("li[data-base]");
  items.forEach((li, i) => {
    const active = i === selected;
    li.classList.toggle("selected", active);
    li.querySelector("button")?.setAttribute(
      "aria-selected",
      active ? "true" : "false",
    );
  });
  search.setAttribute(
    "aria-activedescendant",
    selected >= 0 ? `proj-${String(selected)}` : "",
  );
  if (projects.length > 0) {
    count.textContent = formatCount(lang, selected + 1, visible.length, projects.length);
  }
  scrollSelectedIntoView();
}

function move(delta: number): void {
  if (visible.length === 0) return;
  selected = moveSelection(selected, delta, visible.length);
  syncSelection();
}

function openSelected(): void {
  const p = visible[selected];
  if (p) void openProject(p.path);
}

function renderBases(): void {
  bases.replaceChildren();
  config.baseDirs.forEach((dir, i) => {
    const li = document.createElement("li");
    paintBaseTint(li, dir);
    const span = document.createElement("span");
    span.className = "base-path";
    span.textContent = dir;
    span.title = dir;
    const rm = document.createElement("button");
    rm.type = "button";
    rm.textContent = t("bases.remove");
    rm.setAttribute("aria-label", removeBaseAriaLabel(lang, dir));
    rm.addEventListener("click", () => void removeBase(i));
    li.append(span, rm);
    bases.appendChild(li);
  });
}

function syncSettings(): void {
  sortSelect.value = config.sortMode;
  themeSelect.value = themeSetting;
  languageSelect.value = languageSetting;
  opencodeBin.value = config.opencodeBin ?? "";
  if (terminalSelect.options.length > 0) {
    terminalSelect.value = config.terminal;
    syncTerminalHint();
  }
}

/**
 * Reads the OS login-item state (the source of truth, like QuickSpot) and
 * paints the checkbox. Never throws: on failure the toggle keeps its
 * previous value.
 */
async function syncAutostart(): Promise<void> {
  try {
    autostartEnabled = await isEnabled();
    autostartToggle.checked = autostartEnabled;
  } catch {
    // The toggle stays as-is; toggling will retry on next change.
  }
}

async function refreshProjects(): Promise<void> {
  projects = await invoke<Project[]>("list_projects");
  renderProjects();
}

// Saves are chained serially: this keeps two concurrent `saveAll` calls
// (e.g. adding two folders quickly or switching terminal while saving)
// from overwriting each other and dropping a freshly added base via a
// stale `config` response.
let saveChain: Promise<void> = Promise.resolve();

function enqueueSave(task: () => Promise<void>): Promise<void> {
  const run = saveChain.then(task, task);
  // The chain never stays broken on failure: the caller sees the error.
  saveChain = run.catch(() => undefined);
  return run;
}

async function saveAll(): Promise<void> {
  // Captured at enqueue time (not at run time): two back-to-back saves each
  // keep their own bases and the last one wins with the freshest snapshot,
  // without losing just-added folders.
  const baseDirs = [...config.baseDirs];
  const opencodeBinValue =
    opencodeBin.value.trim() === "" ? null : opencodeBin.value.trim();
  const terminal = terminalSelect.value;
  const sortMode = normalizeSortMode(sortSelect.value);
  const language = normalizeLanguageSetting(languageSelect.value);
  const theme = normalizeThemeSetting(themeSelect.value);
  return enqueueSave(async () => {
    config = await invoke<Config>("save_config", {
      baseDirs,
      opencodeBin: opencodeBinValue,
      terminal,
      sortMode,
      language,
      theme,
    });
    // The backend normalizes: apply the canonical mode and language to the UI.
    // An explicit "en"/"es" is kept as-is; "auto" follows the system.
    config.sortMode = normalizeSortMode(config.sortMode);
    applyLanguageSetting(config.language);
    applyThemeSetting(config.theme);
    applyI18n();
    syncSettings();
    renderTerminalOptions();
    // The backend sanitizes (trims, dedupes): re-render so stale bases
    // never linger in the UI. Bases are re-painted here because tints
    // follow the active scheme; rows refresh below via `refreshProjects`.
    renderBases();
    // Immediate refresh: the backend also emits `projects-changed` with the
    // freshly scanned list, so the window shows inner folders as soon as the
    // base is added (other views get it too).
    await refreshProjects();
  });
}

async function openProject(path: string): Promise<void> {
  try {
    await invoke("open_project", { path });
  } catch (e) {
    showError(typeof e === "string" ? e : String(e));
  }
}

async function removeBase(index: number): Promise<void> {
  const prevBases = [...config.baseDirs];
  config.baseDirs = config.baseDirs.filter((_, i) => i !== index);
  renderBases();
  try {
    await saveAll();
  } catch (e) {
    // Reverts the optimistic change: otherwise the UI would show a base the
    // backend did not store and it would look "not loading" on reload.
    config.baseDirs = prevBases;
    renderBases();
    showError(typeof e === "string" ? e : String(e));
  }
}

addBase.addEventListener("click", () => {
  void (async () => {
    try {
      const picked = await open({
        directory: true,
        multiple: true,
        title: t("dialog.chooseBase"),
      });
      if (picked === null) return;
      const dirs = (Array.isArray(picked) ? picked : [picked]).filter(
        (d): d is string => typeof d === "string" && d.trim() !== "",
      );
      if (dirs.length === 0) return;
      // Normalizes so `/a` and `/a/` do not duplicate the base.
      const known = new Set(config.baseDirs.map(normalizeBaseDir));
      const prevBases = [...config.baseDirs];
      let added = false;
      for (const raw of dirs) {
        const d = normalizeBaseDir(raw);
        if (d === "" || known.has(d)) continue;
        known.add(d);
        config.baseDirs.push(d);
        added = true;
      }
      if (!added) return;
      // Clears the filter: otherwise new projects stay hidden behind the
      // previous filter and it looks like the folder "did not load".
      if (search.value !== "") search.value = "";
      renderBases();
      try {
        await saveAll();
      } catch (e) {
        // Reverts the optimistic change so a base the backend did not store
        // is not shown (its inner folders would never appear).
        config.baseDirs = prevBases;
        renderBases();
        showError(typeof e === "string" ? e : String(e));
      }
    } catch (e) {
      showError(typeof e === "string" ? e : String(e));
    }
  })();
});

save.addEventListener("click", () => {
  void (async () => {
    try {
      await saveAll();
    } catch (e) {
      showError(typeof e === "string" ? e : String(e));
    }
  })();
});

// Launch at login: immediate OS toggle (same mechanism as QuickSpot), not
// part of `save_config`. The OS is the source of truth; on failure the
// checkbox reverts so it never shows a state that was not applied.
autostartToggle.addEventListener("change", () => {
  const next = autostartToggle.checked;
  // Optimistic revert guard: disable the toggle while applying.
  autostartToggle.disabled = true;
  void (async () => {
    try {
      if (next) await enable();
      else await disable();
      autostartEnabled = next;
      autostartToggle.checked = next;
    } catch (e) {
      autostartToggle.checked = autostartEnabled;
      showError(typeof e === "string" ? e : String(e));
    } finally {
      autostartToggle.disabled = false;
    }
  })();
});

// Sort change: immediate re-render for instant feedback and a persistent
// save like the terminal picker.
sortSelect.addEventListener("change", () => {
  const next = normalizeSortMode(sortSelect.value);
  if (next === config.sortMode) return;
  const prev = config.sortMode;
  config.sortMode = next;
  sortSelect.value = next;
  renderProjects();
  void (async () => {
    try {
      await saveAll();
    } catch (e) {
      // Reverts the optimistic change when the backend did not save.
      config.sortMode = prev;
      sortSelect.value = prev;
      renderProjects();
      showError(typeof e === "string" ? e : String(e));
    }
  })();
});

// Theme change: instant apply for immediate feedback and a persistent
// save like the language picker. "auto" follows the OS scheme (with a live
// listener below); an explicit id is kept until changed again.
themeSelect.addEventListener("change", () => {
  const nextSetting = normalizeThemeSetting(themeSelect.value);
  if (nextSetting === themeSetting) return;
  const prevSetting = themeSetting;
  applyThemeSetting(nextSetting);
  themeSelect.value = themeSetting;
  renderProjects();
  renderBases();
  void (async () => {
    try {
      await saveAll();
    } catch (e) {
      // Reverts the optimistic change when the backend did not save.
      applyThemeSetting(prevSetting);
      themeSelect.value = prevSetting;
      renderProjects();
      renderBases();
      showError(typeof e === "string" ? e : String(e));
    }
  })();
});

// `auto` tracks live OS scheme changes without a reload; an explicit theme
// is untouched by the OS.
function watchSystemScheme(): void {
  try {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    mq.addEventListener("change", () => {
      if (themeSetting !== "auto") return;
      applyThemeSetting("auto");
      renderProjects();
      renderBases();
    });
  } catch {
    // No matchMedia: `auto` simply stays on the boot resolution.
  }
}

// Language change: immediate re-render for instant feedback and a persistent
// save like the sort and terminal pickers. "auto" follows the system language
// (English fallback); an explicit "en"/"es" is kept until changed again.
languageSelect.addEventListener("change", () => {
  const nextSetting = normalizeLanguageSetting(languageSelect.value);
  if (nextSetting === languageSetting) return;
  const prevSetting = languageSetting;
  const prevLang = lang;
  applyLanguageSetting(nextSetting);
  languageSelect.value = languageSetting;
  applyI18n();
  renderTerminalOptions();
  renderProjects();
  renderBases();
  void (async () => {
    try {
      await saveAll();
    } catch (e) {
      // Reverts the optimistic change when the backend did not save.
      languageSetting = prevSetting;
      config.language = prevSetting;
      lang = prevLang;
      languageSelect.value = prevSetting;
      applyI18n();
      renderTerminalOptions();
      renderProjects();
      renderBases();
      showError(typeof e === "string" ? e : String(e));
    }
  })();
});

// Immediate save: the chosen terminal is the one used
// when a project is clicked, without relying on the Save button.
terminalSelect.addEventListener("change", () => {
  void (async () => {
    try {
      await saveAll();
    } catch (e) {
      showError(typeof e === "string" ? e : String(e));
      terminalSelect.value = config.terminal;
      syncTerminalHint();
    }
  })();
});

search.addEventListener("input", renderProjects);

search.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || (e.ctrlKey && (e.key === "n" || e.key === "j"))) {
    e.preventDefault();
    move(1);
  } else if (e.key === "ArrowUp" || (e.ctrlKey && (e.key === "p" || e.key === "k"))) {
    e.preventDefault();
    move(-1);
  } else if (e.key === "Enter") {
    e.preventDefault();
    openSelected();
  } else if (e.key === "Escape") {
    if (search.value !== "") {
      search.value = "";
      renderProjects();
    } else {
      search.blur();
    }
  }
});

// TUI-style global shortcuts: `/` focuses, `j/k` navigate when not typing.
document.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement | null;
  const typing =
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
  if (e.key === "/" && !typing) {
    e.preventDefault();
    search.focus();
  } else if (!typing && (e.key === "j" || e.key === "ArrowDown")) {
    move(1);
  } else if (!typing && (e.key === "k" || e.key === "ArrowUp")) {
    e.preventDefault();
    move(-1);
  } else if (!typing && e.key === "Enter") {
    openSelected();
  }
});

reload.addEventListener("click", () => {
  void (async () => {
    try {
      projects = await invoke<Project[]>("refresh");
      renderProjects();
    } catch (e) {
      showError(typeof e === "string" ? e : String(e));
    }
  })();
});

quit.addEventListener("click", () => {
  void invoke("quit");
});

async function init(): Promise<void> {
  // The version does not depend on the backend: paint it even if
  // `get_config` fails.
  void showVersion();
  // Update wiring never blocks boot and never throws (silent dev-degrade).
  wireUpdateEvents();
  try {
    const [cfg, terms] = await Promise.all([
      invoke<Config>("get_config"),
      invoke<TerminalInfo[]>("list_terminals"),
    ]);
    // Old configs lack `sortMode` (falls back to "name", the historic order).
    // `language` is a stored setting: "auto" (default, follows the system
    // language with an English fallback) or an explicit "en"/"es" that wins.
    // `theme` is the same shape for color: "auto" (default, follows the OS
    // scheme) or one of the 8 curated ids; unknown values fall back to "auto".
    config = { ...cfg, sortMode: normalizeSortMode(cfg.sortMode) };
    applyLanguageSetting(cfg.language);
    applyThemeSetting((cfg as Config).theme);
    terminals = terms;
    applyI18n();
    renderTerminalOptions();
    syncSettings();
    renderBases();
    watchSystemScheme();
    await refreshProjects();
    // OS login-item state is independent of the config file: refresh after
    // boot so the checkbox shows the real state (like QuickSpot).
    void syncAutostart();
    // The backend emits `projects-changed` after `save_config` / `refresh` /
    // tray reload with the freshly scanned list: the payload is applied
    // directly for an immediate refresh (no second invoke).
    await listen<Project[]>("projects-changed", (event) => {
      if (Array.isArray(event.payload)) {
        projects = event.payload;
        renderProjects();
      } else {
        void refreshProjects();
      }
    });
    await listen<string>("open-error", (event) => {
      showError(event.payload);
    });
    // In-app updates: check on start, on window-show (5-minute throttle)
    // and every 6 hours while running. All throttled inside
    // `checkForUpdates`; every failure degrades silently. After a login
    // (hidden) start the automatic checks wait for the first manual show;
    // the first focus/visibility event arms them (see listeners below).
    try {
      updatesPausedForAutostart = await invoke<boolean>("was_autostart_launch");
    } catch {
      updatesPausedForAutostart = false;
    }
    if (!updatesPausedForAutostart) void checkForUpdates();
    window.addEventListener("focus", () => {
      updatesPausedForAutostart = false;
      void checkForUpdates();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      updatesPausedForAutostart = false;
      void checkForUpdates();
    });
    window.setInterval(() => {
      if (updatesPausedForAutostart) return;
      void checkForUpdates();
    }, UPDATE_PERIODIC_CHECK_INTERVAL_MS);
  } catch (e) {
    showError(typeof e === "string" ? e : String(e));
  }
}

void init();
