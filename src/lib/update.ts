/**
 * In-app update policy: throttle math, postpone semantics and panel
 * suppression. DOM-free and Tauri-free so Vitest (`node` env) can cover
 * every branch; `src/main.ts` wires these helpers to the real updater
 * plugin, the `#update-popup` modal and the Settings row.
 */

/** Minimum gap between automatic checks (5 minutes). Exported for tests. */
export const UPDATE_MIN_CHECK_INTERVAL_MS = 300_000;

/** Periodic check while the app runs (6 hours). Exported for tests. */
export const UPDATE_PERIODIC_CHECK_INTERVAL_MS = 21_600_000;

/** localStorage key for the On-next-open deferred version. */
export const NEXT_OPEN_KEY = "codedock.update.nextOpenVersion";

/** DOM id of the update modal. */
export const UPDATE_MODAL_ID = "update-popup";

/** Dismiss gesture mapping: Esc, close button and backdrop all mean Later. */
export type UpdatePromptDecision = "now" | "later" | "next-open";
export const ESC_DISMISS_DECISION: UpdatePromptDecision = "later";
export const BACKDROP_DISMISS_DECISION: UpdatePromptDecision = "later";
export const CLOSE_DISMISS_DECISION: UpdatePromptDecision = "later";

/** Session-only snooze: Later re-offers after restart. Never persisted. */
let dismissedVersion: string | null = null;

/** Current session snooze (null when nothing snoozed). */
export function getDismissedVersion(): string | null {
  return dismissedVersion;
}

/** Test hook: sets or clears the session snooze directly. */
export function setDismissedVersion(version: string | null): void {
  dismissedVersion = version;
}

/** Clears the session snooze (e.g. between tests). */
export function clearUpdateSnooze(): void {
  dismissedVersion = null;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Reads the persisted On-next-open version. Never throws (silent degrade). */
export function getNextOpenVersion(storage: StorageLike | null | undefined): string | null {
  try {
    if (!storage) return null;
    const v = storage.getItem(NEXT_OPEN_KEY);
    return typeof v === "string" && v !== "" ? v : null;
  } catch {
    return null;
  }
}

/** Persists the On-next-open version. Never throws (silent degrade). */
export function setNextOpenVersion(
  storage: StorageLike | null | undefined,
  version: string,
): void {
  try {
    storage?.setItem(NEXT_OPEN_KEY, version);
  } catch {
    // Private mode or no storage: deferral simply does not persist.
  }
}

/** Clears the persisted On-next-open version. Never throws. */
export function clearNextOpenVersion(storage: StorageLike | null | undefined): void {
  try {
    storage?.removeItem(NEXT_OPEN_KEY);
  } catch {
    // Private mode or no storage: nothing to clear.
  }
}

/** Strips a leading `v`/`V` and trims: `"v1.2.4"` -> `"1.2.4"`. */
export function stripVersionPrefix(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const v = raw.trim();
  if (v === "") return "";
  return v.startsWith("v") || v.startsWith("V") ? v.slice(1).trim() : v;
}

/** Splits `"1.2.4-beta.1"` into numeric parts + prerelease flag. */
function parseVersionParts(version: string): { nums: number[]; pre: string } {
  const [core, ...preRest] = version.split("-");
  const nums = (core ?? "").split(".").map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  return { nums, pre: preRest.join("-") };
}

/**
 * Compares two versions numerically (`-1 | 0 | 1`). A bare release beats
 * its prerelease (`1.2.4` > `1.2.4-beta`); unparseable input compares as 0.
 */
export function compareVersions(a: unknown, b: unknown): -1 | 0 | 1 {
  const sa = stripVersionPrefix(a);
  const sb = stripVersionPrefix(b);
  if (sa === "" || sb === "") return 0;
  const pa = parseVersionParts(sa);
  const pb = parseVersionParts(sb);
  const len = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < len; i++) {
    const x = pa.nums[i] ?? 0;
    const y = pb.nums[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === "") return 1;
  if (pb.pre === "") return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

/** Whether `available` is strictly newer than `current`. */
export function isNewerVersion(available: unknown, current: unknown): boolean {
  if (typeof available !== "string" || typeof current !== "string") return false;
  if (available.trim() === "" || current.trim() === "") return false;
  return compareVersions(available, current) === 1;
}

/**
 * Throttle math: true when no check ran yet or `minIntervalMs` elapsed.
 * A clock that moved backwards (`nowMs < lastCheckMs`) allows a check so
 * the throttle can never wedge the updater shut.
 */
export function shouldCheckNow(
  lastCheckMs: number | null | undefined,
  nowMs: number,
  minIntervalMs: number = UPDATE_MIN_CHECK_INTERVAL_MS,
): boolean {
  if (lastCheckMs === null || lastCheckMs === undefined) return true;
  if (!Number.isFinite(lastCheckMs) || !Number.isFinite(nowMs)) return true;
  if (nowMs < lastCheckMs) return true;
  return nowMs - lastCheckMs >= minIntervalMs;
}

/** Manual Settings checks always bypass the 5-minute throttle. */
export function shouldBypassThrottle(manual: boolean): boolean {
  return manual === true;
}

/** Which panels suppress the modal while the user works in them. */
export interface UpdatePanelState {
  settingsOpen: boolean;
  actionsOpen: boolean;
}

/** True while Settings or Actions are open: defer the prompt, re-offer later. */
export function shouldDeferForPanels(state: UpdatePanelState): boolean {
  return state.settingsOpen === true || state.actionsOpen === true;
}

/**
 * Whether the prompt should appear for `available`. False when it is not
 * newer, when this session snoozed it (Later), or when it is deferred to
 * the next open (auto-install path, no re-prompt).
 */
export function shouldOfferUpdate(
  available: unknown,
  current: unknown,
  opts: { dismissedVersion: string | null; nextOpenVersion: string | null },
): boolean {
  if (!isNewerVersion(available, current)) return false;
  if (typeof available !== "string") return false;
  const v = available.trim();
  if (opts.dismissedVersion !== null && v === opts.dismissedVersion) return false;
  if (opts.nextOpenVersion !== null && v === opts.nextOpenVersion) return false;
  return true;
}

/**
 * On-next-open semantics: when the available version equals the persisted
 * deferral, the app auto-installs on launch without re-prompting.
 */
export function shouldAutoInstallOnStart(
  available: unknown,
  nextOpenVersion: string | null,
): boolean {
  if (typeof available !== "string") return false;
  if (available.trim() === "") return false;
  if (nextOpenVersion === null) return false;
  return available.trim() === nextOpenVersion;
}

/**
 * Records a prompt decision: Later snoozes only the session, On-next-open
 * persists across restarts, Update-now clears both markers for the version.
 * Never throws (storage failures degrade silently).
 */
export function recordPromptDecision(
  version: string,
  decision: UpdatePromptDecision,
  storage: StorageLike | null | undefined,
): void {
  const v = version.trim();
  if (v === "") return;
  if (decision === "later") {
    dismissedVersion = v;
  } else if (decision === "next-open") {
    setNextOpenVersion(storage, v);
    if (dismissedVersion === v) dismissedVersion = null;
  } else {
    if (dismissedVersion === v) dismissedVersion = null;
    try {
      if (storage?.getItem(NEXT_OPEN_KEY) === v) storage.removeItem(NEXT_OPEN_KEY);
    } catch {
      // Silent degrade: markers simply linger until the next decision.
    }
  }
}

/** Prompt buttons are disabled for the whole download+install. */
export function areUpdateControlsLocked(downloading: boolean): boolean {
  return downloading === true;
}

/**
 * Throttle keeper with an injectable clock (tests pass a fake `now`).
 * `main.ts` uses the default wall clock.
 */
export function createUpdateScheduler(opts: { now?: () => number } = {}): {
  getLastCheckMs: () => number | null;
  setLastCheckMs: (ms: number | null) => void;
  canCheckNow: (nowMs?: number, minIntervalMs?: number) => boolean;
  markChecked: (nowMs?: number) => void;
} {
  const now = opts.now ?? ((): number => Date.now());
  let lastCheckMs: number | null = null;
  return {
    getLastCheckMs: (): number | null => lastCheckMs,
    setLastCheckMs: (ms: number | null): void => {
      lastCheckMs = ms;
    },
    canCheckNow: (nowMs?: number, minIntervalMs?: number): boolean =>
      shouldCheckNow(lastCheckMs, nowMs ?? now(), minIntervalMs),
    markChecked: (nowMs?: number): void => {
      lastCheckMs = nowMs ?? now();
    },
  };
}

/** Replaces `{version}` / `{percent}` tokens in update i18n strings. */
export function fillUpdateTemplate(template: string, values: { version?: string; percent?: number }): string {
  let out = template;
  if (values.version !== undefined) out = out.split("{version}").join(values.version);
  if (values.percent !== undefined) out = out.split("{percent}").join(String(values.percent));
  return out;
}
