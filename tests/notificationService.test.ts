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
      location: { origin: "https://dev-focus-timer.sondrelassen.workers.dev" },
    });
    vi.stubGlobal("navigator", mockNavigator);
    vi.stubGlobal("Notification", mockNotification);

    return { reg, calls, postMessage, showNotification, getNotifications, pushManager };
  }

  it("dispatches clean native OS notifications with standard options and no custom SW messaging or vibration", async () => {
    const { showNotification, postMessage } = setupBrowserMocks();

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
    expect(options).toEqual({
      body: "Your focus timer has finished. Time for a break.",
      icon: "/icon-192.png",
      badge: "/badge-72.png",
      tag: "pomodor-session-run-42",
      silent: false,
    });
    expect((options as any).requireInteraction).toBeUndefined();
    expect((options as any).renotify).toBeUndefined();
    expect((options as any).vibrate).toBeUndefined();
    expect(postMessage).not.toHaveBeenCalled();
    expect((navigator as any).vibrate).not.toHaveBeenCalled();
  });

  it("subscribes to PushManager with applicationServerKey, handles key rotation, and registers origin with backend", async () => {
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
        origin: "https://dev-focus-timer.sondrelassen.workers.dev",
      })
    );
  });

  it("supports Safari Declarative Web Push window.pushManager when no Service Worker registration exists", async () => {
    const vapidKeyBytes = new Uint8Array(65);
    vapidKeyBytes[0] = 0x04;
    vapidKeyBytes.fill(0x33, 1);
    const vapidB64u = btoa(String.fromCharCode(...vapidKeyBytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const windowSub = {
      endpoint: "https://web.push.apple.com/declarative-tok",
      toJSON: () => ({
        keys: { p256dh: "APPLE_P256DH", auth: "APPLE_AUTH" },
      }),
    };
    const windowPushManager = {
      getSubscription: vi.fn(async () => null),
      subscribe: vi.fn(async () => windowSub),
    };

    const mockNotification: any = function () {};
    mockNotification.permission = "granted";
    vi.stubGlobal("window", {
      pushManager: windowPushManager,
      Notification: mockNotification,
      location: { origin: "https://focus-timer.sondrelassen.workers.dev" },
    });
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.5 Safari/605.1.15",
      maxTouchPoints: 0,
    });
    vi.stubGlobal("Notification", mockNotification);

    const registerFn = vi.fn(async () => "sub-apple-1");
    const svc = new NotificationService();
    expect(svc.isPushSupported()).toBe(true);

    const res = await svc.syncPushSubscription({
      vapidPublicKey: vapidB64u,
      deviceId: "mac-safari-1",
      registerFn,
    });

    expect(res).toEqual({ ok: true, status: "active" });
    expect(windowPushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(registerFn).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: "mac-safari-1",
        endpoint: "https://web.push.apple.com/declarative-tok",
        origin: "https://focus-timer.sondrelassen.workers.dev",
      })
    );
  });

  describe("public/sw.js Declarative Web Push fallback and notificationclick", () => {
    const swSource = fs.readFileSync(
      path.resolve(process.cwd(), "public/sw.js"),
      "utf8"
    );

    function createSwSandbox({
      existingClients = [] as Array<{
        url: string;
        visibilityState?: string;
        focus: ReturnType<typeof vi.fn>;
        postMessage?: ReturnType<typeof vi.fn>;
      }>,
      existingNotifications = [] as Array<{ tag: string; close: ReturnType<typeof vi.fn> }>,
    } = {}) {
      const listeners = new Map<string, (e: any) => void>();
      const shownNotifications: Array<{ title: string; options: any }> = [];
      const openWindow = vi.fn(async () => undefined);
      const matchAll = vi.fn(async () => existingClients);
      const getNotifications = vi.fn(async () => existingNotifications);

      const selfObj: any = {
        location: { origin: "https://pomodor.example" },
        addEventListener: (type: string, cb: (e: any) => void) => {
          listeners.set(type, cb);
        },
        skipWaiting: vi.fn(async () => undefined),
        clients: {
          claim: vi.fn(async () => undefined),
          matchAll,
          openWindow,
        },
        registration: {
          getNotifications,
          showNotification: vi.fn(async (title: string, options: any) => {
            shownNotifications.push({ title, options });
          }),
          pushManager: {
            subscribe: vi.fn(async () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/rotated" })),
          },
        },
      };

      const context = vm.createContext({
        self: selfObj,
        URL,
        Date,
        Promise,
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

      const dispatchNotificationClick = async (data?: Record<string, unknown>) => {
        let waitPromise: Promise<unknown> = Promise.resolve();
        const close = vi.fn();
        const cb = listeners.get("notificationclick")!;
        cb({
          notification: { data, close },
          waitUntil: (p: Promise<unknown>) => {
            waitPromise = p;
          },
        });
        await waitPromise;
        return { close };
      };

      const dispatchPushSubscriptionChange = async (oldSub?: any, newSub?: any) => {
        let waitPromise: Promise<unknown> = Promise.resolve();
        const cb = listeners.get("pushsubscriptionchange")!;
        cb({
          oldSubscription: oldSub,
          newSubscription: newSub,
          waitUntil: (p: Promise<unknown>) => {
            waitPromise = p;
          },
        });
        await waitPromise;
      };

      return {
        dispatchPush,
        dispatchNotificationClick,
        dispatchPushSubscriptionChange,
        shownNotifications,
        openWindow,
        matchAll,
        getNotifications,
      };
    }

    beforeEach(() => {
      vi.useRealTimers();
    });

    it("unwraps Declarative Web Push (web_push: 8030) payloads, propagates timestamp, and closes older session notifications", async () => {
      const olderClose = vi.fn();
      const testClose = vi.fn();
      const { dispatchPush, shownNotifications } = createSwSandbox({
        existingNotifications: [
          { tag: "pomodor-session-run-old", close: olderClose },
          { tag: "pomodor-test-123", close: testClose },
        ],
      });
      const ts = 1795368615161;
      await dispatchPush({
        web_push: 8030,
        mutable: false,
        notification: {
          title: "Pomodor — Focus session complete",
          body: "Your focus timer has finished. Time for a break.",
          navigate: "https://pomodor.example/",
          icon: "https://pomodor.example/icon-192.png",
          badge: "https://pomodor.example/badge-72.png",
          tag: "pomodor-session-run-sw-1",
          silent: false,
          timestamp: ts,
        },
      });

      expect(olderClose).toHaveBeenCalledTimes(1);
      expect(testClose).not.toHaveBeenCalled();
      expect(shownNotifications).toHaveLength(1);
      expect(shownNotifications[0].title).toBe("Pomodor — Focus session complete");
      expect(shownNotifications[0].options).toEqual({
        body: "Your focus timer has finished. Time for a break.",
        icon: "https://pomodor.example/icon-192.png",
        badge: "https://pomodor.example/badge-72.png",
        tag: "pomodor-session-run-sw-1",
        silent: false,
        timestamp: ts,
        data: { navigate: "https://pomodor.example/" },
      });
      expect(shownNotifications[0].options.requireInteraction).toBeUndefined();
      expect(shownNotifications[0].options.renotify).toBeUndefined();
      expect(shownNotifications[0].options.vibrate).toBeUndefined();
    });

    it("silences incoming timer completion push when a visible client window is open (Decision 2A)", async () => {
      const visibleSandbox = createSwSandbox({
        existingClients: [
          { url: "https://pomodor.example/", visibilityState: "visible", focus: vi.fn() },
        ],
      });
      await visibleSandbox.dispatchPush({
        web_push: 8030,
        mutable: false,
        notification: {
          title: "Pomodor — Focus session complete",
          body: "Done!",
          tag: "pomodor-session-run-vis-1",
          silent: false,
        },
      });
      expect(visibleSandbox.shownNotifications[0].options.silent).toBe(true);

      // Hidden client preserves audible OS notification
      const hiddenSandbox = createSwSandbox({
        existingClients: [
          { url: "https://pomodor.example/", visibilityState: "hidden", focus: vi.fn() },
        ],
      });
      await hiddenSandbox.dispatchPush({
        web_push: 8030,
        mutable: false,
        notification: {
          title: "Pomodor — Focus session complete",
          body: "Done!",
          tag: "pomodor-session-run-hid-1",
          silent: false,
        },
      });
      expect(hiddenSandbox.shownNotifications[0].options.silent).toBe(false);
    });

    it("supports flat JSON fallback and propagates silent: true cleanly", async () => {
      const { dispatchPush, shownNotifications } = createSwSandbox();

      await dispatchPush({
        title: "Pomodor — Focus session complete",
        body: "Muted alert",
        tag: "pomodor-session-run-silent-1",
        silent: true,
      });

      expect(shownNotifications).toHaveLength(1);
      expect(shownNotifications[0].options.silent).toBe(true);
      expect(shownNotifications[0].options.tag).toBe("pomodor-session-run-silent-1");
      expect(shownNotifications[0].options.vibrate).toBeUndefined();
      expect(shownNotifications[0].options.renotify).toBeUndefined();
    });

    it("focuses an existing same-origin tab, enforces same-origin navigate URL, and includes uncontrolled clients on notificationclick", async () => {
      const focus = vi.fn(async () => undefined);
      const withTab = createSwSandbox({
        existingClients: [{ url: "https://pomodor.example/", focus }],
      });
      const { close } = await withTab.dispatchNotificationClick({
        navigate: "https://pomodor.example/",
      });
      expect(close).toHaveBeenCalledTimes(1);
      expect(withTab.matchAll).toHaveBeenCalledWith({
        type: "window",
        includeUncontrolled: true,
      });
      expect(focus).toHaveBeenCalledTimes(1);
      expect(withTab.openWindow).not.toHaveBeenCalled();

      const withoutTab = createSwSandbox({ existingClients: [] });
      await withoutTab.dispatchNotificationClick({
        navigate: "https://pomodor.example/timer",
      });
      expect(withoutTab.openWindow).toHaveBeenCalledWith("https://pomodor.example/timer");

      // Cross-origin navigate URL must be rejected and clamped to self.location.origin + '/'
      const evilTab = createSwSandbox({ existingClients: [] });
      await evilTab.dispatchNotificationClick({
        navigate: "https://phishing.example.com/steal",
      });
      expect(evilTab.openWindow).toHaveBeenCalledWith("https://pomodor.example/");
    });

    it("handles pushsubscriptionchange by notifying open window clients to re-sync", async () => {
      const postMessage = vi.fn();
      const sandbox = createSwSandbox({
        existingClients: [
          {
            url: "https://pomodor.example/",
            visibilityState: "visible",
            focus: vi.fn(),
            postMessage,
          },
        ],
      });
      await sandbox.dispatchPushSubscriptionChange(
        { options: { applicationServerKey: new Uint8Array(65) } },
        null
      );
      expect(postMessage).toHaveBeenCalledWith({ type: "PUSH_SUBSCRIPTION_CHANGED" });
    });
  });

  it("propagates silent: true without custom vibrate or renotify flags", async () => {
    const { showNotification } = setupBrowserMocks();

    const svc = new NotificationService();
    const ok = await svc.notify(
      "Pomodor — Focus session complete",
      "Muted banner",
      false,
      "run-muted-1",
      { silent: true }
    );

    expect(ok).toBe(true);
    expect(showNotification).toHaveBeenCalledTimes(1);
    const [, options] = showNotification.mock.calls[0];
    expect(options.silent).toBe(true);
    expect((options as any).renotify).toBeUndefined();
    expect((options as any).vibrate).toBeUndefined();
    expect((navigator as any).vibrate).not.toHaveBeenCalled();
  });

  it("returns false when both Tier 1 and Tier 2 fail and does NOT poison lastNotifiedSessionId for retries", async () => {
    const { showNotification, postMessage } = setupBrowserMocks();
    showNotification.mockRejectedValueOnce(new Error("SW showNotification failed"));

    const throwingNotification: any = vi.fn(() => {
      throw new Error("Illegal constructor");
    });
    throwingNotification.permission = "granted";
    vi.stubGlobal("Notification", throwingNotification);
    (window as any).Notification = throwingNotification;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const svc = new NotificationService();

    const firstAttempt = await svc.notify(
      "Pomodor — Focus session complete",
      "Your focus timer has finished. Time for a break.",
      false,
      "run-retry-1"
    );

    expect(firstAttempt).toBe(false);
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(throwingNotification).toHaveBeenCalledTimes(1);
    expect(postMessage).not.toHaveBeenCalled();

    // Retry for the exact same sessionRunId must succeed now that Tier 1 works
    const secondAttempt = await svc.notify(
      "Pomodor — Focus session complete",
      "Your focus timer has finished. Time for a break.",
      false,
      "run-retry-1"
    );

    expect(secondAttempt).toBe(true);
    expect(showNotification).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });

  it("destroy() detaches controllerchange and visibilitychange listeners cleanly", () => {
    const swRemoveEventListener = vi.fn();
    const docAddEventListener = vi.fn();
    const docRemoveEventListener = vi.fn();
    setupBrowserMocks();
    (navigator as any).serviceWorker.removeEventListener = swRemoveEventListener;
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: docAddEventListener,
      removeEventListener: docRemoveEventListener,
    });

    const svc = new NotificationService();
    const swAddedCb = (navigator as any).serviceWorker.addEventListener.mock.calls.find(
      (c: unknown[]) => c[0] === "controllerchange"
    )?.[1];
    const docAddedCb = docAddEventListener.mock.calls.find(
      (c: unknown[]) => c[0] === "visibilitychange"
    )?.[1];

    expect(swAddedCb).toBeTypeOf("function");
    expect(docAddedCb).toBeTypeOf("function");

    svc.destroy();

    expect(swRemoveEventListener).toHaveBeenCalledWith("controllerchange", swAddedCb);
    expect(docRemoveEventListener).toHaveBeenCalledWith("visibilitychange", docAddedCb);
  });

  it("SoundService uses pure native Web Audio without global window listeners and resumes interrupted contexts", async () => {
    const { SoundService } = await import("../src/services/audio/SoundService");
    const addEventListener = vi.fn();
    const startMock = vi.fn();
    const stopMock = vi.fn();
    const resumeMock = vi.fn(async () => {
      mockCtx.state = "running";
    });

    const mockCtx: any = {
      state: "interrupted",
      currentTime: 10,
      destination: {},
      resume: resumeMock,
      createOscillator: vi.fn(() => ({
        type: "sine",
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: startMock,
        stop: stopMock,
      })),
      createGain: vi.fn(() => ({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      })),
    };

    vi.stubGlobal("window", {
      addEventListener,
      AudioContext: vi.fn(function () {
        return mockCtx;
      }),
    });

    const sound = new SoundService();
    // No global gesture listener workarounds registered on construction
    expect(addEventListener).not.toHaveBeenCalled();

    // Resumes WebKit 'interrupted' context and plays the 3 triad notes
    sound.playChime(0.7);
    await new Promise((r) => setTimeout(r, 0));

    expect(resumeMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledTimes(3);
    expect(stopMock).toHaveBeenCalledTimes(3);

    // Volume 0 is a no-op
    startMock.mockClear();
    sound.playChime(0);
    expect(startMock).not.toHaveBeenCalled();
  });

  it("SoundService skips phantom chime when ctx.resume() resolves after >1500ms", async () => {
    vi.useFakeTimers();
    try {
      const { SoundService } = await import("../src/services/audio/SoundService");
      const startMock = vi.fn();
      let resolveResume!: () => void;

      const mockCtx: any = {
        state: "suspended",
        currentTime: 5,
        destination: {},
        resume: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveResume = () => {
                mockCtx.state = "running";
                resolve();
              };
            })
        ),
        createOscillator: vi.fn(() => ({
          type: "sine",
          frequency: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: startMock,
          stop: vi.fn(),
        })),
        createGain: vi.fn(() => ({
          gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: vi.fn(),
          disconnect: vi.fn(),
        })),
      };

      vi.stubGlobal("window", {
        AudioContext: vi.fn(function () {
          return mockCtx;
        }),
      });

      const sound = new SoundService();
      sound.playChime(0.8);

      // Simulate user waking the suspended AudioContext much later (>1500ms)
      vi.advanceTimersByTime(2000);
      resolveResume();
      await Promise.resolve();

      expect(startMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("SoundService recreates a closed AudioContext cleanly", async () => {
    const { SoundService } = await import("../src/services/audio/SoundService");
    const firstStart = vi.fn();
    const secondStart = vi.fn();

    const firstCtx: any = {
      state: "running",
      currentTime: 1,
      destination: {},
      resume: vi.fn(async () => {}),
      createOscillator: vi.fn(() => ({
        type: "sine",
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: firstStart,
        stop: vi.fn(),
      })),
      createGain: vi.fn(() => ({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
    };

    const secondCtx: any = {
      state: "running",
      currentTime: 2,
      destination: {},
      resume: vi.fn(async () => {}),
      createOscillator: vi.fn(() => ({
        type: "sine",
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: secondStart,
        stop: vi.fn(),
      })),
      createGain: vi.fn(() => ({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
    };

    const audioContextCtor = vi
      .fn()
      .mockImplementationOnce(function () {
        return firstCtx;
      })
      .mockImplementationOnce(function () {
        return secondCtx;
      });

    vi.stubGlobal("window", {
      AudioContext: audioContextCtor,
    });

    const sound = new SoundService();
    sound.playChime(0.8);
    expect(audioContextCtor).toHaveBeenCalledTimes(1);
    expect(firstStart).toHaveBeenCalledTimes(3);

    // Simulate OS/browser closing the first AudioContext
    firstCtx.state = "closed";
    sound.playChime(0.8);

    expect(audioContextCtor).toHaveBeenCalledTimes(2);
    expect(secondStart).toHaveBeenCalledTimes(3);
  });

  it("SoundService stops and disconnects previous oscillators on rapid playChime() calls and onended", async () => {
    const { SoundService } = await import("../src/services/audio/SoundService");
    const createdOscs: Array<{
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      onended: (() => void) | null;
    }> = [];
    const createdGains: Array<{ disconnect: ReturnType<typeof vi.fn> }> = [];

    const mockCtx: any = {
      state: "running",
      currentTime: 0,
      destination: {},
      resume: vi.fn(async () => {}),
      createOscillator: vi.fn(() => {
        const osc = {
          type: "sine",
          frequency: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
          onended: null as (() => void) | null,
        };
        createdOscs.push(osc);
        return osc;
      }),
      createGain: vi.fn(() => {
        const gain = {
          gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: vi.fn(),
          disconnect: vi.fn(),
        };
        createdGains.push(gain);
        return gain;
      }),
    };

    vi.stubGlobal("window", {
      AudioContext: vi.fn(function () {
        return mockCtx;
      }),
    });

    const sound = new SoundService();
    sound.playChime(0.8);
    expect(createdOscs).toHaveLength(3);

    // Rapid second chime should stop & disconnect the first 3 nodes before scheduling 3 new ones
    sound.playChime(0.8);
    expect(createdOscs).toHaveLength(6);

    for (let i = 0; i < 3; i++) {
      // Called once with scheduled stop time, and once immediately when superseded
      expect(createdOscs[i].stop).toHaveBeenCalledTimes(2);
      expect(createdOscs[i].disconnect).toHaveBeenCalledTimes(1);
      expect(createdGains[i].disconnect).toHaveBeenCalledTimes(1);
    }

    // Firing onended on the active second chime disconnects its nodes cleanly
    for (let i = 3; i < 6; i++) {
      expect(createdOscs[i].onended).toBeTypeOf("function");
      createdOscs[i].onended!();
      expect(createdOscs[i].disconnect).toHaveBeenCalledTimes(1);
      expect(createdGains[i].disconnect).toHaveBeenCalledTimes(1);
    }
  });

  it("SoundService safely handles NaN/subnormal volumes and throwing AudioContext constructors without crashing", async () => {
    const { SoundService } = await import("../src/services/audio/SoundService");
    const rampMock = vi.fn();
    const startMock = vi.fn();
    const mockCtx: any = {
      state: "running",
      currentTime: 1,
      destination: {},
      resume: vi.fn(async () => {}),
      createOscillator: vi.fn(() => ({
        type: "sine",
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: startMock,
        stop: vi.fn(),
      })),
      createGain: vi.fn(() => ({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: rampMock },
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
    };

    vi.stubGlobal("window", {
      AudioContext: vi.fn(function () {
        return mockCtx;
      }),
    });

    const sound = new SoundService();
    // NaN / Infinity must be ignored safely
    expect(() => sound.playChime(Number.NaN)).not.toThrow();
    expect(() => sound.playChime(Number.POSITIVE_INFINITY)).not.toThrow();
    expect(startMock).not.toHaveBeenCalled();

    // Subnormal volume must clamp peakGain >= 0.001 so exponentialRamp never receives 0
    expect(() => sound.playChime(1e-320)).not.toThrow();
    expect(startMock).toHaveBeenCalledTimes(3);
    expect(rampMock.mock.calls[0][0]).toBeGreaterThanOrEqual(0.001);

    // Throwing AudioContext constructor must never crash prepareForPlayback or playChime
    vi.stubGlobal("window", {
      AudioContext: vi.fn(() => {
        throw new Error("AudioContext quota exceeded");
      }),
    });
    const sound2 = new SoundService();
    expect(() => sound2.prepareForPlayback()).not.toThrow();
    expect(() => sound2.playChime(0.8)).not.toThrow();
  });

  it("SoundService recycles zombie running AudioContext whose currentTime stays frozen after markStaleForRecovery()", async () => {
    vi.useFakeTimers();
    try {
      const { SoundService } = await import("../src/services/audio/SoundService");
      const firstStart = vi.fn();
      const secondStart = vi.fn();
      const firstClose = vi.fn(async () => {});

      const makeCtx = (startFn: ReturnType<typeof vi.fn>, closeFn?: ReturnType<typeof vi.fn>) => ({
        state: "running",
        currentTime: 42,
        destination: {},
        resume: vi.fn(async () => {}),
        close: closeFn ?? vi.fn(async () => {}),
        createOscillator: vi.fn(() => ({
          type: "sine",
          frequency: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: startFn,
          stop: vi.fn(),
        })),
        createGain: vi.fn(() => ({
          gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: vi.fn(),
          disconnect: vi.fn(),
        })),
      });

      const firstCtx = makeCtx(firstStart, firstClose);
      const secondCtx = makeCtx(secondStart);
      const audioContextCtor = vi
        .fn()
        .mockImplementationOnce(function () {
          return firstCtx;
        })
        .mockImplementationOnce(function () {
          return secondCtx;
        });

      vi.stubGlobal("window", { AudioContext: audioContextCtor });

      const sound = new SoundService();
      sound.playChime(0.8);
      expect(firstStart).toHaveBeenCalledTimes(3);

      // Simulate wake from sleep where CoreAudio freezes ctx.currentTime at 42
      sound.markStaleForRecovery();
      sound.playChime(0.8);
      // Should probe before scheduling on the frozen context
      expect(firstStart).toHaveBeenCalledTimes(3);

      vi.advanceTimersByTime(150);
      expect(firstClose).toHaveBeenCalledTimes(1);
      expect(audioContextCtor).toHaveBeenCalledTimes(2);
      expect(secondStart).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("NotificationService clears failed SW registration cache, handles expired subscriptions, and cancels in-flight sync on unsubscribePush", async () => {
    const { reg, pushManager } = setupBrowserMocks();
    const registerSpy = (navigator as any).serviceWorker.register as ReturnType<typeof vi.fn>;

    // 1. Transient SW registration failure does NOT permanently poison subsequent attempts
    const getRegSpy = (navigator as any).serviceWorker.getRegistration as ReturnType<typeof vi.fn>;
    (navigator as any).serviceWorker.ready = new Promise(() => {});
    getRegSpy.mockResolvedValueOnce(null);
    registerSpy.mockRejectedValueOnce(new Error("Offline during initial SW register"));
    const svc = new NotificationService();
    // Wait for initial constructor promise rejection to settle
    await new Promise((r) => setTimeout(r, 0));

    getRegSpy.mockResolvedValueOnce(null);
    registerSpy.mockResolvedValueOnce(reg);
    const ok = await svc.notify("Title", "Body", true);
    expect(ok).toBe(true);
    expect(registerSpy).toHaveBeenCalledTimes(2);

    // 2. Expired PushSubscription (expirationTime <= Date.now()) is proactively replaced
    const vapidKeyBytes = new Uint8Array(65);
    vapidKeyBytes[0] = 0x04;
    vapidKeyBytes.fill(0x44, 1);
    const vapidB64u = btoa(String.fromCharCode(...vapidKeyBytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const expiredSub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/expired",
      expirationTime: Date.now() - 1000,
      options: { applicationServerKey: vapidKeyBytes.buffer },
      unsubscribe: vi.fn(async () => true),
      toJSON: () => ({ keys: { p256dh: "OLD_P256DH", auth: "OLD_AUTH" } }),
    };
    const renewedSub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/renewed",
      expirationTime: null,
      options: { applicationServerKey: vapidKeyBytes.buffer },
      unsubscribe: vi.fn(async () => true),
      toJSON: () => ({ keys: { p256dh: "NEW_P256DH", auth: "NEW_AUTH" } }),
    };
    pushManager.getSubscription.mockResolvedValueOnce(expiredSub);
    pushManager.subscribe.mockResolvedValueOnce(renewedSub);

    const registerFn = vi.fn(async () => "sub-renewed");
    const syncRes = await svc.syncPushSubscription({
      vapidPublicKey: vapidB64u,
      deviceId: "dev-1",
      registerFn,
    });
    expect(syncRes).toEqual({ ok: true, status: "active" });
    expect(expiredSub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(registerFn).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "https://fcm.googleapis.com/fcm/send/renewed" })
    );

    // 3. unsubscribePush() invalidates an in-flight syncPushSubscription() so status stays unsubscribed
    let resolveInFlightRegister!: () => void;
    const slowRegisterFn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveInFlightRegister = resolve;
        })
    );
    pushManager.getSubscription.mockResolvedValue(renewedSub);

    const inFlightSync = svc.syncPushSubscription({
      vapidPublicKey: vapidB64u,
      deviceId: "dev-1",
      registerFn: slowRegisterFn,
    });
    await new Promise((r) => setTimeout(r, 0));

    // User toggles notifications OFF while registerFn is still in-flight
    const unregisterFn = vi.fn(async () => {});
    await svc.unsubscribePush(unregisterFn);
    expect(svc.getPushStatus()).toBe("unsubscribed");

    resolveInFlightRegister();
    const staleSyncResult = await inFlightSync;
    expect(staleSyncResult.ok).toBe(false);
    expect(svc.getPushStatus()).toBe("unsubscribed");

    // 4. resetPushStatus emits to subscribers cleanly
    const statuses: string[] = [];
    const unsubStatus = svc.subscribePushStatus((s) => statuses.push(s));
    svc.resetPushStatus("unconfigured");
    expect(svc.getPushStatus()).toBe("unconfigured");
    expect(statuses).toContain("unconfigured");
    unsubStatus();
  });
});
