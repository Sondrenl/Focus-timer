// @vitest-environment node
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  useTimerAlerts,
  UseTimerAlertsParams,
} from "../src/context/timer/useTimerAlerts";
import { DEFAULT_SETTINGS, UserSettings } from "../src/types/settings";
import { SoundService } from "../src/services/audio/SoundService";
import { NotificationService, PushSubscriptionStatus } from "../src/services/notification/NotificationService";

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => {
      store.set(key, String(val));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
  };
}

function createHarness(overrides?: {
  settings?: Partial<UserSettings>;
  hasPermission?: boolean;
  pushStatus?: PushSubscriptionStatus;
  notifyResult?: boolean;
  isAuthenticated?: boolean;
  isConvexConnected?: boolean;
  isDevicePushRegistered?: boolean | undefined;
}) {
  const playChime = vi.fn();
  const notify = vi.fn(async () => overrides?.notifyResult ?? true);
  const sound = { playChime } as unknown as SoundService;
  const notifications = {
    hasPermission: vi.fn(() => overrides?.hasPermission ?? true),
    getPushStatus: vi.fn(() => overrides?.pushStatus ?? "active"),
    notify,
  } as unknown as NotificationService;

  const params: UseTimerAlertsParams = {
    timerRunIdRef: { current: null },
    settingsRef: {
      current: {
        ...DEFAULT_SETTINGS,
        soundEnabled: true,
        soundVolume: 0.75,
        notificationsEnabled: true,
        ...overrides?.settings,
      },
    },
    sound,
    notifications,
    isEffectiveAuthenticatedRef: { current: overrides?.isAuthenticated ?? true },
    isConvexConnectedRef: { current: overrides?.isConvexConnected ?? true },
    isDevicePushRegisteredRef: {
      current:
        overrides && "isDevicePushRegistered" in overrides
          ? overrides.isDevicePushRegistered
          : true,
    },
  };

  let captured!: ReturnType<typeof useTimerAlerts>;
  const Probe: React.FC = () => {
    captured = useTimerAlerts(params);
    return null;
  };
  renderToStaticMarkup(React.createElement(Probe));

  return {
    dispatchCompletionAlert: captured.dispatchCompletionAlert,
    playChime,
    notify,
    params,
  };
}

describe("useTimerAlerts (Decision 2A, live push fallback, cross-tab dedup)", () => {
  let storage: ReturnType<typeof createLocalStorageMock>;

  beforeEach(() => {
    storage = createLocalStorageMock();
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("document", { visibilityState: "visible" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("plays instant in-app Web Audio chime when visible even when Web Push is active (Decision 2A)", () => {
    const { dispatchCompletionAlert, playChime, notify } = createHarness({
      pushStatus: "active",
      isAuthenticated: true,
      isConvexConnected: true,
      isDevicePushRegistered: true,
    });

    dispatchCompletionAlert("WORK", "run-visible-push-1");

    expect(playChime).toHaveBeenCalledTimes(1);
    expect(playChime).toHaveBeenCalledWith(0.75);
    // Server Web Push handles the silenced visual banner when active; no duplicate local notify
    expect(notify).not.toHaveBeenCalled();
  });

  it("plays instant chime AND shows silent local banner when visible without active Web Push", () => {
    const { dispatchCompletionAlert, playChime, notify } = createHarness({
      pushStatus: "unsubscribed",
      isAuthenticated: false,
    });

    dispatchCompletionAlert("SHORT_BREAK", "run-visible-local-1");

    expect(playChime).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      false,
      "run-visible-local-1",
      { silent: true }
    );
  });

  it("delegates cleanly to server Web Push when hidden and all liveness checks pass", () => {
    vi.stubGlobal("document", { visibilityState: "hidden" });
    const { dispatchCompletionAlert, playChime, notify } = createHarness({
      pushStatus: "active",
      isAuthenticated: true,
      isConvexConnected: true,
      isDevicePushRegistered: true,
    });

    dispatchCompletionAlert("WORK", "run-hidden-delegated-1");

    expect(playChime).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("falls back to local OS notification (and chime if notify fails) when hidden and WebSocket is disconnected or device was server-pruned", async () => {
    vi.stubGlobal("document", { visibilityState: "hidden" });

    // Case A: Convex WebSocket disconnected
    const disconnected = createHarness({
      pushStatus: "active",
      isConvexConnected: false,
    });
    disconnected.dispatchCompletionAlert("WORK", "run-hidden-ws-down");
    expect(disconnected.notify).toHaveBeenCalledTimes(1);
    expect(disconnected.notify).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      false,
      "run-hidden-ws-down",
      { silent: false }
    );

    // Case B: Server pruned this device's push subscription (isDevicePushRegistered === false)
    const pruned = createHarness({
      pushStatus: "active",
      isConvexConnected: true,
      isDevicePushRegistered: false,
      notifyResult: false, // OS notification also fails -> must fall back to chime
    });
    pruned.dispatchCompletionAlert("WORK", "run-hidden-pruned");
    await new Promise((r) => setTimeout(r, 0));
    expect(pruned.notify).toHaveBeenCalledTimes(1);
    expect(pruned.playChime).toHaveBeenCalledTimes(1);
  });

  it("deduplicates across tabs while allowing a visible tab to upgrade a hidden tab's silent delegation claim", () => {
    // Tab A is hidden and silently delegates to Web Push first
    vi.stubGlobal("document", { visibilityState: "hidden" });
    const tabA = createHarness({ pushStatus: "active" });
    tabA.dispatchCompletionAlert("WORK", "run-multitab-1");
    expect(tabA.playChime).not.toHaveBeenCalled();

    // Tab B is visible and completes 20ms later -> must still play the instant in-app chime!
    vi.stubGlobal("document", { visibilityState: "visible" });
    const tabB = createHarness({ pushStatus: "active" });
    tabB.dispatchCompletionAlert("WORK", "run-multitab-1");
    expect(tabB.playChime).toHaveBeenCalledTimes(1);

    // Tab C is also visible -> already claimed with audible: true, must NOT double-chime!
    const tabC = createHarness({ pushStatus: "active" });
    tabC.dispatchCompletionAlert("WORK", "run-multitab-1");
    expect(tabC.playChime).not.toHaveBeenCalled();
  });

  it("does not drop distinct short intervals (<4s apart) that have unique runIds", () => {
    const { dispatchCompletionAlert, playChime } = createHarness({
      settings: { notificationsEnabled: false },
    });

    dispatchCompletionAlert("WORK", "run-short-1");
    dispatchCompletionAlert("SHORT_BREAK", "run-short-2");

    expect(playChime).toHaveBeenCalledTimes(2);
  });
});
