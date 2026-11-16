import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { NotificationService, urlBase64ToUint8Array } from "../src/services/notification/NotificationService";

describe("NotificationService & Service Worker mobile behavior", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function setupBrowserMocks({
    userAgent = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile Safari/537.36",
    maxTouchPoints = 5,
    permission = "granted",
    existingNotifications = [] as Array<{ tag: string; close: ReturnType<typeof vi.fn> }>,
    existingSub = null as any,
    subscribedSub = null as any,
  } = {}) {
    const calls: string[] = [];
    const postMessage = vi.fn();
    const showNotification = vi.fn(async (_title: string, options: NotificationOptions) => {
      calls.push(`show:${options.tag}`);
    });
    const getNotifications = vi.fn(async (filter?: { tag?: string }) => {
      calls.push(`get:${filter?.tag ?? "all"}`);
      if (filter?.tag) {
        return existingNotifications.filter((n) => n.tag === filter.tag);
      }
      return existingNotifications;
    });

    for (const notif of existingNotifications) {
      const origClose = notif.close;
      notif.close = vi.fn(() => {
        calls.push(`close:${notif.tag}`);
        origClose();
      });
    }

    const pushManager = {
      getSubscription: vi.fn(async () => existingSub),
      subscribe: vi.fn(async () => subscribedSub),
    };

    const reg: any = {
      active: { postMessage },
      showNotification,
      getNotifications,
      pushManager,
      update: vi.fn(async () => undefined),
    };

    const mockNavigator: any = {
      userAgent,
      maxTouchPoints,
      vibrate: vi.fn(),
      serviceWorker: {
        register: vi.fn(async () => reg),
        ready: Promise.resolve(reg),
        getRegistration: vi.fn(async () => reg),
        controller: { postMessage },
        addEventListener: vi.fn(),
      },
    };

    const mockNotification: any = function () {};
    mockNotification.permission = permission;
    mockNotification.requestPermission = vi.fn(async () => permission);

    vi.stubGlobal("window", {
      PushManager: function () {},
      Notification: mockNotification,
    });
    vi.stubGlobal("navigator", mockNavigator);
    vi.stubGlobal("Notification", mockNotification);

    return { reg, calls, postMessage, showNotification, getNotifications, pushManager };
  }

  it("closes older notifications BEFORE calling showNotification, uses badge-72.png, and omits requireInteraction on mobile", async () => {
    const oldNotif = { tag: "pomodor-session-old", close: vi.fn() };
    const { calls, showNotification } = setupBrowserMocks({
      existingNotifications: [oldNotif],
    });

    const svc = new NotificationService();
    const ok = await svc.notify(
      "Pomodor — Focus session complete",
      "Your focus timer has finished. Time for a break.",
      false,
      "run-42"
    );

    expect(ok).toBe(true);
    expect(showNotification).toHaveBeenCalledTimes(1);
    const [, options] = showNotification.mock.calls[0];
    expect(options.badge).toBe("/badge-72.png");
    expect(options.tag).toBe("pomodor-session-run-42");
    expect((options as any).requireInteraction).toBeUndefined();

    const closeIdx = calls.indexOf("close:pomodor-session-old");
    const showIdx = calls.indexOf("show:pomodor-session-run-42");
    expect(closeIdx).toBeGreaterThan(-1);
    expect(showIdx).toBeGreaterThan(closeIdx);
  });

  it("keeps requireInteraction: true on desktop browsers", async () => {
    const { showNotification } = setupBrowserMocks({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/125.0.0.0 Safari/537.36",
      maxTouchPoints: 0,
    });

    const svc = new NotificationService();
    await svc.notify("Done", "Break time", false, "run-desktop-1");

    const [, options] = showNotification.mock.calls[0];
    expect((options as any).requireInteraction).toBe(true);
    expect(options.badge).toBe("/badge-72.png");
  });

  it("subscribes to PushManager with applicationServerKey, handles key rotation, and registers with backend", async () => {
    const vapidKeyBytes = new Uint8Array(65);
    vapidKeyBytes[0] = 0x04;
    vapidKeyBytes.fill(0x11, 1);
    const vapidB64u = btoa(String.fromCharCode(...vapidKeyBytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const oldKeyBytes = new Uint8Array(65);
    oldKeyBytes[0] = 0x04;
    oldKeyBytes.fill(0x22, 1);
    const staleSub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/old",
      options: { applicationServerKey: oldKeyBytes.buffer },
      unsubscribe: vi.fn(async () => true),
    };
    const freshSub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/fresh",
      toJSON: () => ({
        keys: { p256dh: "FRESH_P256DH", auth: "FRESH_AUTH" },
      }),
    };

    const { pushManager } = setupBrowserMocks({
      existingSub: staleSub,
      subscribedSub: freshSub,
    });

    const registerFn = vi.fn(async () => "sub-id-1");
    const svc = new NotificationService();
    const res = await svc.syncPushSubscription({
      vapidPublicKey: vapidB64u,
      deviceId: "pixel-8",
      registerFn,
    });

    expect(res).toEqual({ ok: true, status: "active" });
    expect(staleSub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidB64u),
    });
    expect(registerFn).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: "pixel-8",
        endpoint: "https://fcm.googleapis.com/fcm/send/fresh",
        p256dh: "FRESH_P256DH",
        auth: "FRESH_AUTH",
        isMobile: true,
      })
    );
  });

  describe("public/sw.js push, staleness, and Safari compliance", () => {
    const swSource = fs.readFileSync(
      path.resolve(process.cwd(), "public/sw.js"),
      "utf8"
    );

    function createSwSandbox({
      userAgent = "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/125.0.0.0 Mobile Safari/537.36",
      visibleClient = false,
    } = {}) {
      const listeners = new Map<string, (e: any) => void>();
      const activeNotifications: Array<{ tag: string; close: () => void }> = [];
      const shownNotifications: Array<{ title: string; options: any }> = [];

      const selfObj: any = {
        location: { origin: "https://pomodor.example" },
        navigator: { userAgent },
        addEventListener: (type: string, cb: (e: any) => void) => {
          listeners.set(type, cb);
        },
        skipWaiting: vi.fn(),
        clients: {
          claim: vi.fn(async () => undefined),
          matchAll: vi.fn(async () =>
            visibleClient ? [{ visibilityState: "visible", url: "https://pomodor.example/" }] : []
          ),
        },
        registration: {
          getNotifications: vi.fn(async (filter?: { tag?: string }) => {
            if (filter?.tag) {
              return activeNotifications.filter((n) => n.tag === filter.tag);
            }
            return [...activeNotifications];
          }),
          showNotification: vi.fn(async (title: string, options: any) => {
            shownNotifications.push({ title, options });
            const notifObj = {
              tag: options.tag,
              close: () => {
                const idx = activeNotifications.indexOf(notifObj);
                if (idx >= 0) activeNotifications.splice(idx, 1);
              },
            };
            activeNotifications.push(notifObj);
          }),
        },
      };

      const context = vm.createContext({
        self: selfObj,
        URL,
        Date,
        Promise,
        setTimeout,
        clearTimeout,
        caches: undefined,
      });
      vm.runInContext(swSource, context);

      const dispatchPush = async (payload: Record<string, unknown>) => {
        let waitPromise: Promise<unknown> = Promise.resolve();
        const cb = listeners.get("push")!;
        cb({
          data: {
            json: () => payload,
            text: () => JSON.stringify(payload),
          },
          waitUntil: (p: Promise<unknown>) => {
            waitPromise = p;
          },
        });
        await waitPromise;
      };

      const dispatchMessage = async (data: Record<string, unknown>) => {
        let waitPromise: Promise<unknown> = Promise.resolve();
        const cb = listeners.get("message")!;
        cb({
          data,
          waitUntil: (p: Promise<unknown>) => {
            waitPromise = p;
          },
        });
        await waitPromise;
      };

      return { dispatchPush, dispatchMessage, shownNotifications, activeNotifications };
    }

    beforeEach(() => {
      vi.useRealTimers();
    });

    it("delivers background Web Push with badge-72.png and omits requireInteraction on Android", async () => {
      const { dispatchPush, shownNotifications } = createSwSandbox({ visibleClient: false });
      await dispatchPush({
        title: "Pomodor — Focus session complete",
        body: "Your focus timer has finished. Time for a break.",
        sessionId: "run-sw-1",
        isMobile: true,
      });

      expect(shownNotifications).toHaveLength(1);
      expect(shownNotifications[0].options.badge).toBe("/badge-72.png");
      expect(shownNotifications[0].options.tag).toBe("pomodor-session-run-sw-1");
      expect(shownNotifications[0].options.requireInteraction).toBeUndefined();
      expect(shownNotifications[0].options.silent).toBe(false);
    });

    it("suppresses duplicate push on Chrome Android when foreground client already marked session notified", async () => {
      const { dispatchPush, dispatchMessage, shownNotifications } = createSwSandbox({
        visibleClient: true,
      });

      await dispatchMessage({ type: "MARK_SESSION_NOTIFIED", sessionId: "run-dup-1" });
      await dispatchPush({
        title: "Pomodor — Focus session complete",
        body: "Your focus timer has finished.",
        sessionId: "run-dup-1",
      });

      expect(shownNotifications).toHaveLength(0);
    });

    it("stays userVisibleOnly-compliant on pure Safari by posting silent update on duplicate push", async () => {
      const { dispatchPush, dispatchMessage, shownNotifications } = createSwSandbox({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
        visibleClient: true,
      });

      await dispatchMessage({ type: "MARK_SESSION_NOTIFIED", sessionId: "run-ios-1" });
      await dispatchPush({
        title: "Pomodor — Focus session complete",
        body: "Your focus timer has finished.",
        sessionId: "run-ios-1",
      });

      expect(shownNotifications).toHaveLength(1);
      expect(shownNotifications[0].options.silent).toBe(true);
      expect(shownNotifications[0].options.renotify).toBe(false);
    });

    it("does NOT fire stale SCHEDULE_TIMER_NOTIFICATION catch-up alerts (>60s past targetEndTime)", async () => {
      const { dispatchMessage, shownNotifications } = createSwSandbox({ visibleClient: false });

      await dispatchMessage({
        type: "SCHEDULE_TIMER_NOTIFICATION",
        targetEndTime: Date.now() - 10 * 60 * 1000, // 10 minutes late
        title: "Pomodor — Focus session complete",
        body: "Stale alert",
        sessionId: "run-stale-1",
        isMobile: true,
      });

      expect(shownNotifications).toHaveLength(0);
    });
  });
});
