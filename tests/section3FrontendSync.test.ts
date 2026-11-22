import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  clearGuestDataModifiedFlag,
  clearOfflineOutbox,
  enqueueOutboxOperation,
  getLocalDataOwner,
  getPendingProfilePatch,
  getPendingSettingsPatch,
  hasGuestDataBeenModified,
  markGuestDataModified,
  readOfflineOutbox,
  removeOutboxOperation,
  setLocalDataOwner,
  subscribeOutboxChange,
} from "../src/services/sync/offlineOutbox";
import {
  parseAndValidateBackupEntities,
  sanitizeBackupProfile,
} from "../src/utils/backupSanitizers";
import {
  AuthService,
  parseGoogleJwt,
  hasStoredConvexAuthSession,
  buildProfileFromJwt,
} from "../src/services/auth/AuthService";
import { SessionRepository } from "../src/services/repository/SessionRepository";
import { TelemetryRepository } from "../src/services/repository/TelemetryRepository";
import { LocalStorageService } from "../src/services/storage/LocalStorageService";
import { NotificationService } from "../src/services/notification/NotificationService";

function makeJwt(payloadObj: Record<string, unknown>): string {
  const encode = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(payloadObj)}.sig`;
}

describe("Section 3: Frontend Auth, Offline Outbox & Sync Utilities", () => {
  let mockStore: Record<string, string> = {};
  let storageListeners: Array<(e: { key: string | null; newValue?: string | null }) => void> = [];
  let mockLocalStorage: Storage;

  beforeEach(() => {
    mockStore = {};
    storageListeners = [];
    mockLocalStorage = {
      getItem: (key: string) => (key in mockStore ? mockStore[key] : null),
      setItem: (key: string, value: string) => {
        mockStore[key] = String(value);
      },
      removeItem: (key: string) => {
        delete mockStore[key];
      },
      clear: () => {
        mockStore = {};
      },
      key: (index: number) => Object.keys(mockStore)[index] ?? null,
      get length() {
        return Object.keys(mockStore).length;
      },
    };

    vi.stubGlobal("localStorage", mockLocalStorage);
    vi.stubGlobal("window", {
      localStorage: mockLocalStorage,
      location: { hostname: "localhost" },
      addEventListener: (event: string, fn: any) => {
        if (event === "storage") storageListeners.push(fn);
      },
      removeEventListener: (event: string, fn: any) => {
        if (event === "storage") {
          storageListeners = storageListeners.filter((l) => l !== fn);
        }
      },
      dispatchEvent: (evt: { type?: string; key: string | null; newValue?: string | null }) => {
        storageListeners.forEach((l) => l(evt));
        return true;
      },
    });
    clearOfflineOutbox();
    clearGuestDataModifiedFlag();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("Persistent Offline Outbox (Decision 3A)", () => {
    it("isolates queued operations per ownerUserId and notifies subscribers", () => {
      const listener = vi.fn();
      const unsub = subscribeOutboxChange(listener);

      const opA = enqueueOutboxOperation("user-a", {
        kind: "record_session",
        payload: {
          localId: "s-1",
          sessionType: "WORK",
          durationSeconds: 1500,
          completedAt: "2026-04-01T10:00:00.000Z",
          timerRunId: "run-1",
        },
      });
      enqueueOutboxOperation("user-b", {
        kind: "add_coffee",
        payload: {
          localId: "c-1",
          date: "2026-04-01",
          createdAt: "2026-04-01T08:00:00.000Z",
        },
      });

      expect(readOfflineOutbox("user-a")).toHaveLength(1);
      expect(readOfflineOutbox("user-b")).toHaveLength(1);
      expect(listener).toHaveBeenCalledTimes(2);

      removeOutboxOperation(opA!.id);
      expect(readOfflineOutbox("user-a")).toHaveLength(0);
      expect(readOfflineOutbox("user-b")).toHaveLength(1);

      clearOfflineOutbox("user-b");
      expect(readOfflineOutbox()).toHaveLength(0);
      unsub();
    });

    it("coalesces update_settings and update_profile patches field-by-field", () => {
      enqueueOutboxOperation("user-a", {
        kind: "update_settings",
        payload: { workDurationMinutes: 40 },
      });
      enqueueOutboxOperation("user-a", {
        kind: "update_settings",
        payload: { autoStartBreaks: true },
      });
      enqueueOutboxOperation("user-a", {
        kind: "update_profile",
        payload: { displayName: "Alice" },
      });
      enqueueOutboxOperation("user-a", {
        kind: "update_profile",
        payload: { dailyGoalMinutes: 180 },
      });

      expect(readOfflineOutbox("user-a")).toHaveLength(2);
      expect(getPendingSettingsPatch("user-a")).toEqual({
        workDurationMinutes: 40,
        autoStartBreaks: true,
      });
      expect(getPendingProfilePatch("user-a")).toEqual({
        displayName: "Alice",
        dailyGoalMinutes: 180,
      });
    });

    it("cancels add_coffee with remove_coffee and create_tag with remove_tag", () => {
      enqueueOutboxOperation("user-a", {
        kind: "add_coffee",
        payload: {
          localId: "local-cup-1",
          date: "2026-04-01",
          createdAt: "2026-04-01T09:00:00.000Z",
        },
      });
      const removeCupOp = enqueueOutboxOperation("user-a", {
        kind: "remove_coffee",
        payload: {
          id: "local-cup-1",
          date: "2026-04-01",
          createdAt: "2026-04-01T09:00:00.000Z",
        },
      });
      expect(removeCupOp).toBeNull();
      expect(readOfflineOutbox("user-a")).toHaveLength(0);

      enqueueOutboxOperation("user-a", {
        kind: "create_tag",
        payload: { id: "tag-temp", name: "Temp", color: "#3B82F6" },
      });
      enqueueOutboxOperation("user-a", {
        kind: "record_session",
        payload: {
          localId: "s-tagged",
          tagId: "tag-temp",
          sessionType: "WORK",
          durationSeconds: 1500,
          completedAt: "2026-04-01T11:00:00.000Z",
        },
      });
      const removeTagOp = enqueueOutboxOperation("user-a", {
        kind: "remove_tag",
        payload: { id: "tag-temp" },
      });
      expect(removeTagOp).toBeNull();
      const remaining = readOfflineOutbox("user-a");
      expect(remaining).toHaveLength(1);
      expect(remaining[0].kind).toBe("record_session");
      if (remaining[0].kind === "record_session") {
        expect(remaining[0].payload.tagId).toBeUndefined();
      }
    });

    it("supersedes prior operations cleanly when reset_all is enqueued", () => {
      enqueueOutboxOperation("user-a", {
        kind: "record_session",
        payload: {
          localId: "s-1",
          sessionType: "WORK",
          durationSeconds: 1500,
          completedAt: "2026-04-01T10:00:00.000Z",
        },
      });
      enqueueOutboxOperation("user-a", {
        kind: "create_tag",
        payload: { id: "tag-keep", name: "Keep", color: "#10B981" },
      });

      enqueueOutboxOperation("user-a", {
        kind: "reset_all",
        payload: { scope: "sessions-only" },
      });
      // sessions-only drops session ops but keeps tag ops
      expect(readOfflineOutbox("user-a").map((o) => o.kind)).toEqual([
        "create_tag",
        "reset_all",
      ]);

      enqueueOutboxOperation("user-a", {
        kind: "reset_all",
        payload: { scope: "factory-reset" },
      });
      // factory-reset drops tags, settings, profile, and prior resets
      expect(readOfflineOutbox("user-a").map((o) => o.kind)).toEqual(["reset_all"]);
    });

    it("tracks local data ownership and clears guest modified flag on account claim", () => {
      expect(getLocalDataOwner()).toBeNull();
      expect(hasGuestDataBeenModified()).toBe(false);

      markGuestDataModified();
      expect(getLocalDataOwner()).toBe("guest");
      expect(hasGuestDataBeenModified()).toBe(true);

      setLocalDataOwner("user:u-123");
      expect(getLocalDataOwner()).toBe("user:u-123");
      expect(hasGuestDataBeenModified()).toBe(false);
    });
  });

  describe("AuthService JWT parsing, expiry & namespace-scoped Convex Auth detection", () => {
    it("rejects malformed JWTs and treats unparseable tokens as expired", () => {
      const authService = new AuthService();
      expect(parseGoogleJwt("not-a-jwt")).toBeNull();
      expect(parseGoogleJwt("a.b")).toBeNull();
      expect(parseGoogleJwt("a.b.c.d")).toBeNull();
      expect(authService.isTokenExpired("not-a-jwt")).toBe(true);

      const almostExpired = makeJwt({
        sub: "123",
        exp: Math.floor(Date.now() / 1000) + 10, // within 30s skew buffer
      });
      expect(authService.isTokenExpired(almostExpired)).toBe(true);

      const valid = makeJwt({
        sub: "123",
        name: "Alice",
        email: "alice@example.com",
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      expect(authService.isTokenExpired(valid)).toBe(false);
      expect(parseGoogleJwt(valid)?.email).toBe("alice@example.com");
    });

    it("scopes hasStoredConvexAuthSession to the configured convexUrl namespace and rejects expired lone JWTs", () => {
      const url = "https://example-123.convex.cloud";
      const escaped = url.replace(/[^a-zA-Z0-9]/g, "");

      // Unrelated deployment key must not match
      localStorage.setItem("__convexAuthRefreshToken_httpsotherconvexcloud", "refresh-token");
      expect(hasStoredConvexAuthSession(url)).toBe(false);

      // Expired lone JWT without refresh token must return false
      const expiredJwt = makeJwt({ exp: Math.floor(Date.now() / 1000) - 60 });
      localStorage.setItem(`__convexAuthJWT_${escaped}`, expiredJwt);
      expect(hasStoredConvexAuthSession(url)).toBe(false);

      // Valid refresh token in matching namespace returns true
      localStorage.setItem(`__convexAuthRefreshToken_${escaped}`, "valid-refresh");
      expect(hasStoredConvexAuthSession(url)).toBe(true);
    });

    it("preserves custom displayName and avatarEmoji in buildProfileFromJwt", () => {
      const existing = {
        id: "u1",
        displayName: "My Custom Alias",
        avatarEmoji: "🦊",
        dailyGoalMinutes: 150,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      const built = buildProfileFromJwt(
        { sub: "sub-1", name: "Google Legal Name", email: "me@example.com" },
        existing
      );
      expect(built.displayName).toBe("My Custom Alias");
      expect(built.avatarEmoji).toBe("🦊");
      expect(built.dailyGoalMinutes).toBe(150);
    });
  });

  describe("Backup sanitizers, repositories & NotificationService hardening", () => {
    it("omits undefined fields and preserves 32-char ZWJ emoji in sanitizeBackupProfile", () => {
      const zwjEmoji = "👩‍👩‍👧‍👦"; // 11 UTF-16 code units
      const result = sanitizeBackupProfile(
        { displayName: undefined, avatarEmoji: zwjEmoji, dailyGoalMinutes: 90 } as any,
        true
      );
      expect(result).toEqual({
        avatarEmoji: zwjEmoji,
        dailyGoalMinutes: 90,
      });
      expect("displayName" in (result ?? {})).toBe(false);

      // Empty profile returns null
      expect(sanitizeBackupProfile({} as any, true)).toBeNull();
    });

    it("preserves timerRunId and offsets legacy same-day coffee fallback timestamps", () => {
      const { validSessions, validCoffee } = parseAndValidateBackupEntities(
        {
          version: "3.0.3",
          exportedAt: "2026-04-01T00:00:00.000Z",
          tags: [],
          sessions: [
            {
              id: "s-1",
              tagId: null,
              sessionType: "WORK",
              durationSeconds: 1500,
              completedAt: "2026-04-01T10:00:00.000Z",
              timerRunId: "run-keep-me",
            },
          ],
          coffeeCups: [
            { id: "c-1", date: "2026-04-01", tagId: null } as any,
            { id: "c-2", date: "2026-04-01", tagId: null } as any,
          ],
        },
        false
      );

      expect(validSessions[0].timerRunId).toBe("run-keep-me");
      expect(validCoffee).toHaveLength(2);
      expect(validCoffee[0].createdAt).not.toBe(validCoffee[1].createdAt);
    });

    it("deduplicates SessionRepository.add by timerRunId", async () => {
      const storage = new LocalStorageService("test_sess_dedup:");
      const repo = new SessionRepository(storage);
      await repo.clear();

      const first = await repo.add({
        tagId: null,
        sessionType: "WORK",
        durationSeconds: 1500,
        completedAt: "2026-04-01T10:00:00.000Z",
        timerRunId: "run-dup-check",
      });
      const second = await repo.add({
        tagId: null,
        sessionType: "WORK",
        durationSeconds: 1500,
        completedAt: "2026-04-01T10:05:00.000Z",
        timerRunId: "run-dup-check",
      });

      expect(second.id).toBe(first.id);
      expect(await repo.getAll()).toHaveLength(1);
    });

    it("scrubs deleted tag references from ml_events_v1 in TelemetryRepository.clearTagReferences", async () => {
      const storage = new LocalStorageService("test_tel_clear:");
      const repo = new TelemetryRepository(storage);

      await repo.recordEvent({
        eventId: "evt-1",
        eventType: "tag_changed",
        attemptId: null,
        timestamp: "2026-04-01T10:00:00.000Z",
        timestampMs: Date.parse("2026-04-01T10:00:00.000Z"),
        localDate: "2026-04-01",
        localHour: 10,
        localMinuteOfDay: 600,
        tagId: "tag-victim",
        fromTagId: "tag-victim",
        toTagId: "tag-survivor",
      });

      await repo.clearTagReferences("tag-victim");

      const events = await repo.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].tagId).toBeNull();
      expect(events[0].fromTagId).toBeNull();
      expect(events[0].toTagId).toBe("tag-survivor");
    });

    it("invalidates LocalStorageService memoryCache when a peer tab dispatches a storage event", () => {
      const storage = new LocalStorageService("test_mem_cache:");
      const setItemSpy = vi
        .spyOn(mockLocalStorage, "setItem")
        .mockImplementationOnce(() => {
          const err = new Error("QuotaExceededError");
          err.name = "QuotaExceededError";
          throw err;
        });

      // Triggers fallback into memoryCache
      storage.setItem("k1", { v: "stale-memory" });
      expect(storage.getItem("k1", null)).toEqual({ v: "stale-memory" });

      setItemSpy.mockRestore();
      localStorage.setItem("test_mem_cache:k1", JSON.stringify({ v: "peer-tab-fresh" }));

      // Dispatch cross-tab storage event
      (window.dispatchEvent as any)({
        type: "storage",
        key: "test_mem_cache:k1",
        newValue: JSON.stringify({ v: "peer-tab-fresh" }),
      });

      expect(storage.getItem("k1", null)).toEqual({ v: "peer-tab-fresh" });
    });

    it("clears pushSyncInFlight on resetPushStatus so quick OFF->ON toggle starts a fresh sync", async () => {
      const service = new NotificationService();
      let resolveFirst!: () => void;
      const firstGate = new Promise<void>((r) => {
        resolveFirst = r;
      });

      // Simulate an in-flight pushSyncInFlight promise
      (service as any).pushSyncInFlight = firstGate.then(() => ({
        status: "active",
      }));

      service.resetPushStatus();
      expect((service as any).pushSyncInFlight).toBeNull();
      resolveFirst();
      await firstGate;
    });
  });
});
