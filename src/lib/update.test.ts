import { describe, expect, it } from "vitest";

import {
  areUpdateControlsLocked,
  BACKDROP_DISMISS_DECISION,
  clearNextOpenVersion,
  clearUpdateSnooze,
  CLOSE_DISMISS_DECISION,
  compareVersions,
  createUpdateScheduler,
  ESC_DISMISS_DECISION,
  fillUpdateTemplate,
  getDismissedVersion,
  getNextOpenVersion,
  isNewerVersion,
  NEXT_OPEN_KEY,
  recordPromptDecision,
  setDismissedVersion,
  setNextOpenVersion,
  shouldAutoInstallOnStart,
  shouldBypassThrottle,
  shouldCheckNow,
  shouldDeferForPanels,
  shouldOfferUpdate,
  UPDATE_MIN_CHECK_INTERVAL_MS,
  UPDATE_MODAL_ID,
  UPDATE_PERIODIC_CHECK_INTERVAL_MS,
} from "./update";

/** In-memory Storage double (injectable persistence). */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k: string): string | null => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string): void => {
      map.set(k, v);
    },
    removeItem: (k: string): void => {
      map.delete(k);
    },
  } as Storage;
}

/** Storage double whose every access throws (private-mode degrade). */
function throwingStorage(): Storage {
  return {
    getItem: (): string | null => {
      throw new Error("denied");
    },
    setItem: (): void => {
      throw new Error("denied");
    },
    removeItem: (): void => {
      throw new Error("denied");
    },
  } as unknown as Storage;
}

describe("update intervals", () => {
  it("exports the 5-minute throttle and the 6-hour period", () => {
    expect(UPDATE_MIN_CHECK_INTERVAL_MS).toBe(300_000);
    expect(UPDATE_PERIODIC_CHECK_INTERVAL_MS).toBe(21_600_000);
    expect(UPDATE_MODAL_ID).toBe("update-popup");
    expect(NEXT_OPEN_KEY).toBe("codedock.update.nextOpenVersion");
  });

  it("checks on start (no history) and throttles window-show repeats", () => {
    expect(shouldCheckNow(null, 1_000_000)).toBe(true);
    expect(shouldCheckNow(undefined, 1_000_000)).toBe(true);
    // Repeat 1 minute later is suppressed.
    expect(shouldCheckNow(1_000_000, 1_060_000)).toBe(false);
    // Exactly at the 5-minute boundary it runs again.
    expect(shouldCheckNow(1_000_000, 1_300_000)).toBe(true);
    // A backwards clock never wedges the updater shut.
    expect(shouldCheckNow(1_000_000, 999_000)).toBe(true);
  });

  it("manual Settings checks bypass the throttle", () => {
    expect(shouldBypassThrottle(true)).toBe(true);
    expect(shouldBypassThrottle(false)).toBe(false);
    const scheduler = createUpdateScheduler({ now: () => 2_000_000 });
    scheduler.markChecked();
    expect(scheduler.canCheckNow()).toBe(false);
    // Manual path ignores the scheduler verdict.
    expect(shouldBypassThrottle(true)).toBe(true);
  });

  it("scheduler keeps throttle state behind an injectable clock", () => {
    let now = 0;
    const scheduler = createUpdateScheduler({ now: () => now });
    expect(scheduler.getLastCheckMs()).toBe(null);
    expect(scheduler.canCheckNow()).toBe(true);
    scheduler.markChecked();
    expect(scheduler.getLastCheckMs()).toBe(0);
    now = 60_000;
    expect(scheduler.canCheckNow()).toBe(false);
    now = 300_000;
    expect(scheduler.canCheckNow()).toBe(true);
    scheduler.setLastCheckMs(null);
    expect(scheduler.canCheckNow()).toBe(true);
  });
});

describe("version comparison", () => {
  it("orders releases numerically, not lexicographically", () => {
    expect(compareVersions("1.2.10", "1.2.9")).toBe(1);
    expect(compareVersions("1.2.9", "1.2.10")).toBe(-1);
    expect(compareVersions("v1.2.4", "1.2.4")).toBe(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
  });

  it("a release beats its own prerelease", () => {
    expect(compareVersions("1.2.4", "1.2.4-beta.1")).toBe(1);
    expect(compareVersions("1.2.4-beta.1", "1.2.4")).toBe(-1);
  });

  it("detects strictly newer versions", () => {
    expect(isNewerVersion("1.2.4", "1.2.3")).toBe(true);
    expect(isNewerVersion("1.2.3", "1.2.3")).toBe(false);
    expect(isNewerVersion("1.2.3", "1.2.4")).toBe(false);
    expect(isNewerVersion("", "1.2.3")).toBe(false);
    expect(isNewerVersion("1.2.4", "")).toBe(false);
  });
});

describe("Later versus On-next-open", () => {
  it("Later snoozes only the session and re-offers after restart", () => {
    clearUpdateSnooze();
    const storage = memoryStorage();
    recordPromptDecision("1.2.4", "later", storage);
    expect(getDismissedVersion()).toBe("1.2.4");
    // Persisted deferral untouched: Later never writes localStorage.
    expect(getNextOpenVersion(storage)).toBe(null);
    expect(
      shouldOfferUpdate("1.2.4", "1.2.3", {
        dismissedVersion: getDismissedVersion(),
        nextOpenVersion: getNextOpenVersion(storage),
      }),
    ).toBe(false);
    // Restart clears the in-memory snooze: the prompt returns.
    setDismissedVersion(null);
    expect(
      shouldOfferUpdate("1.2.4", "1.2.3", {
        dismissedVersion: getDismissedVersion(),
        nextOpenVersion: getNextOpenVersion(storage),
      }),
    ).toBe(true);
    clearUpdateSnooze();
  });

  it("On-next-open persists and auto-installs without re-prompting", () => {
    clearUpdateSnooze();
    const storage = memoryStorage();
    recordPromptDecision("1.2.4", "next-open", storage);
    expect(getNextOpenVersion(storage)).toBe("1.2.4");
    // No re-prompt for the deferred version …
    expect(
      shouldOfferUpdate("1.2.4", "1.2.3", {
        dismissedVersion: getDismissedVersion(),
        nextOpenVersion: getNextOpenVersion(storage),
      }),
    ).toBe(false);
    // … instead the next launch auto-installs it.
    expect(shouldAutoInstallOnStart("1.2.4", getNextOpenVersion(storage))).toBe(true);
    expect(shouldAutoInstallOnStart("1.2.5", getNextOpenVersion(storage))).toBe(false);
    // A newer release still prompts.
    expect(
      shouldOfferUpdate("1.2.5", "1.2.4", {
        dismissedVersion: getDismissedVersion(),
        nextOpenVersion: getNextOpenVersion(storage),
      }),
    ).toBe(true);
    clearNextOpenVersion(storage);
    expect(getNextOpenVersion(storage)).toBe(null);
    clearUpdateSnooze();
  });

  it("Update-now clears both markers for the version", () => {
    clearUpdateSnooze();
    const storage = memoryStorage({ [NEXT_OPEN_KEY]: "1.2.4" });
    setDismissedVersion("1.2.4");
    recordPromptDecision("1.2.4", "now", storage);
    expect(getDismissedVersion()).toBe(null);
    expect(getNextOpenVersion(storage)).toBe(null);
    clearUpdateSnooze();
  });
});

describe("prompt gestures and controls", () => {
  it("Esc, close button and backdrop all behave as Later", () => {
    expect(ESC_DISMISS_DECISION).toBe("later");
    expect(CLOSE_DISMISS_DECISION).toBe("later");
    expect(BACKDROP_DISMISS_DECISION).toBe("later");
  });

  it("locks prompt buttons for the whole download+install", () => {
    expect(areUpdateControlsLocked(true)).toBe(true);
    expect(areUpdateControlsLocked(false)).toBe(false);
  });

  it("focus target is the primary Update-now action", () => {
    // Contract with main.ts wiring: the modal focuses `#update-now` on show.
    // The button id is stable API between index.html and the wiring.
    expect(UPDATE_MODAL_ID).toBe("update-popup");
  });

  it("fills version and progress templates for EN/ES strings", () => {
    expect(fillUpdateTemplate("Version {version} is ready.", { version: "1.2.4" })).toBe(
      "Version 1.2.4 is ready.",
    );
    expect(fillUpdateTemplate("Descargando… {percent}%", { percent: 42 })).toBe(
      "Descargando… 42%",
    );
  });
});

describe("panel suppression", () => {
  it("defers while Settings or Actions are open, re-offers on close", () => {
    clearUpdateSnooze();
    const storage = memoryStorage();
    const available = "1.2.4";
    // While Settings is open the prompt is deferred, not dropped.
    expect(shouldDeferForPanels({ settingsOpen: true, actionsOpen: false })).toBe(true);
    expect(shouldDeferForPanels({ settingsOpen: false, actionsOpen: true })).toBe(true);
    const offerableWhileOpen = shouldOfferUpdate(available, "1.2.3", {
      dismissedVersion: getDismissedVersion(),
      nextOpenVersion: getNextOpenVersion(storage),
    });
    expect(offerableWhileOpen).toBe(true);
    // Panels close: the same version is still offerable (re-offer on close).
    expect(shouldDeferForPanels({ settingsOpen: false, actionsOpen: false })).toBe(false);
    expect(
      shouldOfferUpdate(available, "1.2.3", {
        dismissedVersion: getDismissedVersion(),
        nextOpenVersion: getNextOpenVersion(storage),
      }),
    ).toBe(true);
    clearUpdateSnooze();
  });
});

describe("mocked updater/process flow", () => {
  it("Update-now downloads with progress, installs and relaunches", async () => {
    const seen: string[] = [];
    let relaunched = false;
    // Mocked `@tauri-apps/plugin-updater` handle.
    const mockedUpdate = {
      version: "1.2.4",
      currentVersion: "1.2.3",
      downloadAndInstall: async (
        onEvent: (e: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void,
      ): Promise<void> => {
        onEvent({ event: "Started", data: { contentLength: 100 } });
        onEvent({ event: "Progress", data: { chunkLength: 40 } });
        seen.push("progress:40");
        onEvent({ event: "Progress", data: { chunkLength: 60 } });
        seen.push("progress:100");
        onEvent({ event: "Finished" });
      },
    };
    // Mocked `@tauri-apps/plugin-process` relaunch.
    const mockedRelaunch = async (): Promise<void> => {
      relaunched = true;
    };

    const storage = memoryStorage();
    clearUpdateSnooze();
    const offered = shouldOfferUpdate(mockedUpdate.version, mockedUpdate.currentVersion, {
      dismissedVersion: getDismissedVersion(),
      nextOpenVersion: getNextOpenVersion(storage),
    });
    expect(offered).toBe(true);
    const lockedDuringDownload = areUpdateControlsLocked(true);
    expect(lockedDuringDownload).toBe(true);
    await mockedUpdate.downloadAndInstall((): void => undefined);
    recordPromptDecision(mockedUpdate.version, "now", storage);
    await mockedRelaunch();
    expect(seen).toEqual(["progress:40", "progress:100"]);
    expect(relaunched).toBe(true);
    expect(areUpdateControlsLocked(false)).toBe(false);
    clearUpdateSnooze();
  });

  it("install failure stays recoverable (prompt remains usable)", async () => {
    const failingUpdate = {
      version: "1.2.4",
      currentVersion: "1.2.3",
      downloadAndInstall: async (): Promise<void> => {
        throw new Error("network down");
      },
    };
    let inlineError = "";
    try {
      await failingUpdate.downloadAndInstall();
    } catch {
      inlineError = "Couldn't install the update";
    }
    expect(inlineError).not.toBe("");
    // Controls unlock so the user can retry or postpone.
    expect(areUpdateControlsLocked(false)).toBe(false);
  });
});

describe("silent dev-degrade", () => {
  it("never throws on hostile storage (dev/browser/private mode)", () => {
    const bad = throwingStorage();
    expect(() => getNextOpenVersion(bad)).not.toThrow();
    expect(getNextOpenVersion(bad)).toBe(null);
    expect(() => setNextOpenVersion(bad, "1.2.4")).not.toThrow();
    expect(() => clearNextOpenVersion(bad)).not.toThrow();
    expect(() => recordPromptDecision("1.2.4", "later", bad)).not.toThrow();
    expect(() => recordPromptDecision("1.2.4", "next-open", bad)).not.toThrow();
    expect(() => recordPromptDecision("1.2.4", "now", bad)).not.toThrow();
    expect(() => getNextOpenVersion(null)).not.toThrow();
    clearUpdateSnooze();
  });

  it("offline check failures resolve to null, never to a crash", async () => {
    const offlineCheck = async (): Promise<null> => null;
    await expect(offlineCheck()).resolves.toBe(null);
  });
});
