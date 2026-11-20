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

    it("propagates silent: true on Web Push and omits vibrate to comply with Notification spec", async () => {
      const { dispatchPush, shownNotifications } = createSwSandbox({ visibleClient: false });

      await dispatchPush({
        title: "Pomodor — Focus session complete",
        body: "Muted alert",
        sessionId: "run-silent-1",
        isMobile: true,
        silent: true,
      });

      expect(shownNotifications).toHaveLength(1);
      expect(shownNotifications[0].options.silent).toBe(true);
      expect(shownNotifications[0].options.renotify).toBe(false);
      expect(shownNotifications[0].options.vibrate).toBeUndefined();
    });
  });

  it("omits vibrate and skips navigator.vibrate when NotificationService.notify is called with silent: true", async () => {
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
    expect((options as any).renotify).toBe(false);
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
    await Promise.resolve();

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
});
