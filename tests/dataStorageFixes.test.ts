// @vitest-environment edge-runtime
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.hoisted(() => {
  if (typeof (globalThis as any).window === "undefined") {
    (globalThis as any).window = {};
  }
  if (!(globalThis as any).window.location) {
    (globalThis as any).window.location = { hostname: "localhost" };
  }
});

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { useCloudMigration } from "../src/hooks/data/useCloudMigration";
import { LocalStorageService } from "../src/services/storage/LocalStorageService";
import { TelemetryRepository } from "../src/services/repository/TelemetryRepository";
import { SessionRepository } from "../src/services/repository/SessionRepository";
import { CoffeeRepository } from "../src/services/repository/CoffeeRepository";
import * as envModule from "../src/utils/environment";
import { MlEvent } from "../src/types/telemetry";

const modules = import.meta.glob("../convex/**/*.*s");

function createQuotaError(): Error & { code: number } {
  const err = new Error("QuotaExceededError") as Error & { code: number };
  err.name = "QuotaExceededError";
  err.code = 22;
  return err;
}

describe("Data, Backup, Storage & Repository Regression Fixes", () => {
  describe("Convex migrations: clearForReplaceBatch & chunked merge tag remapping", () => {
    async function createAuthenticatedTestUser(t: ReturnType<typeof convexTest>) {
      const userId = await t.mutation(internal.users.getOrCreateUserForAuth, {
        email: "migration-fix@example.com",
        sub: "google-sub-migration-fix",
        name: "Migration Tester",
      });
      const asUser = t.withIdentity({
        subject: `${userId}|session-1`,
        email: "migration-fix@example.com",
        name: "Migration Tester",
      });
      return { userId, asUser };
    }

    it("requires authentication on clearForReplaceBatch", async () => {
      const t = convexTest(schema, modules);
      await expect(t.mutation(api.migrations.clearForReplaceBatch, {})).rejects.toThrow(
        /Unauthorized/i
      );
    });

    it("loops clearForReplaceBatch to wipe >500 docs per table and passes skipReplaceClear on chunk 0", async () => {
      const t = convexTest(schema, modules);
      const { userId, asUser } = await createAuthenticatedTestUser(t);

      // Seed 620 sessions and 520 coffee cups directly into DB (> 500 batch limit)
      await t.run(async (ctx) => {
        const baseMs = Date.parse("2026-01-01T00:00:00.000Z");
        for (let i = 0; i < 620; i++) {
          await ctx.db.insert("sessions", {
            userId,
            tagId: "tag-study",
            sessionType: "WORK",
            durationSeconds: 1500,
            completedAt: new Date(baseMs + i * 60_000).toISOString(),
          });
        }
        for (let i = 0; i < 520; i++) {
          await ctx.db.insert("coffee_cups", {
            userId,
            date: "2026-01-01",
            tagId: "tag-study",
            createdAt: new Date(baseMs + i * 1_000).toISOString(),
          });
        }
      });

      const clearBatchSpy = vi.fn(async () =>
        asUser.mutation(api.migrations.clearForReplaceBatch, {})
      );
      const importBackupSpy = vi.fn(async (args: any) =>
        asUser.mutation(api.migrations.importBackup, args)
      );

      let syncChunked!: ReturnType<typeof useCloudMigration>["syncBackupToConvexChunked"];
      function Harness() {
        const { syncBackupToConvexChunked } = useCloudMigration({
          isEffectiveAuthenticated: true,
          convexSync: {
            isConvexConfigured: true,
            convexUser: undefined,
            convexCoffee: undefined,
            convexSessions: undefined,
            mutations: {
              clearForReplaceBatch: clearBatchSpy,
              importBackup: importBackupSpy,
            } as any,
          } as any,
        });
        syncChunked = syncBackupToConvexChunked;
        return null;
      }

      renderToStaticMarkup(React.createElement(Harness));

      await syncChunked(
        "replace",
        [{ id: "tag-fresh", name: "Fresh Focus", color: "#10B981", isArchived: false }],
        [
          {
            id: "new-session-1",
            tagId: "tag-fresh",
            sessionType: "WORK",
            durationSeconds: 1800,
            completedAt: "2026-04-01T10:00:00.000Z",
          },
        ],
        [
          {
            id: "new-cup-1",
            date: "2026-04-01",
            tagId: "tag-fresh",
            createdAt: "2026-04-01T09:00:00.000Z",
          },
        ]
      );

      // 620 sessions -> batch 1 deletes 500 (hasMore: true), batch 2 deletes 120 (hasMore: false)
      expect(clearBatchSpy).toHaveBeenCalledTimes(2);
      expect(importBackupSpy).toHaveBeenCalledTimes(1);
      expect(importBackupSpy.mock.calls[0][0].skipReplaceClear).toBe(true);

      const sessionsAfter = await asUser.query(api.sessions.list, { limit: 5000 });
      expect(sessionsAfter).toHaveLength(1);
      expect(sessionsAfter?.[0].completedAt).toBe("2026-04-01T10:00:00.000Z");
      expect(sessionsAfter?.[0].tagId).toBe("tag-fresh");

      const coffeeAfter = await asUser.query(api.coffee.list, { limit: 5000 });
      expect(coffeeAfter).toHaveLength(1);
      expect(coffeeAfter?.[0].date).toBe("2026-04-01");
      expect(coffeeAfter?.[0].tagId).toBe("tag-fresh");
    });

    it("preserves remapped tagId on chunks 1..N during chunked merge without duplicating tags", async () => {
      const t = convexTest(schema, modules);
      const { asUser } = await createAuthenticatedTestUser(t);

      // User starts with default "Study & Learning" (id: "tag-study")
      const initialUser = await asUser.query(api.users.current, {});
      const initialTagCount = initialUser?.tags.length ?? 0;

      const importBackupSpy = vi.fn(async (args: any) =>
        asUser.mutation(api.migrations.importBackup, args)
      );

      let syncChunked!: ReturnType<typeof useCloudMigration>["syncBackupToConvexChunked"];
      function Harness() {
        const { syncBackupToConvexChunked } = useCloudMigration({
          isEffectiveAuthenticated: true,
          convexSync: {
            isConvexConfigured: true,
            convexUser: undefined,
            convexCoffee: undefined,
            convexSessions: undefined,
            mutations: {
              importBackup: importBackupSpy,
            } as any,
          } as any,
        });
        syncChunked = syncBackupToConvexChunked;
        return null;
      }

      renderToStaticMarkup(React.createElement(Harness));

      // 450 sessions spans 2 chunks (BACKUP_CHUNK_SIZE = 400 -> chunk 0 has 400, chunk 1 has 50)
      const baseMs = Date.parse("2026-02-01T00:00:00.000Z");
      const sessionsToSync = Array.from({ length: 450 }, (_, idx) => ({
        id: `ext-session-${idx}`,
        tagId: "external-study-id",
        sessionType: "WORK" as const,
        durationSeconds: 1500,
        // Space sessions 2 minutes apart so ±45s dedup keeps all 450
        completedAt: new Date(baseMs + idx * 120_000).toISOString(),
      }));

      await syncChunked(
        "merge",
        [{ id: "external-study-id", name: "Study & Learning", color: "#3B82F6" }],
        sessionsToSync,
        []
      );

      expect(importBackupSpy).toHaveBeenCalledTimes(2);
      // Both chunk 0 and chunk 1 must receive tags so tagIdRemap is rebuilt on chunk 1
      expect(importBackupSpy.mock.calls[0][0].tags).toHaveLength(1);
      expect(importBackupSpy.mock.calls[1][0].tags).toHaveLength(1);

      const sessionsAfter = await asUser.query(api.sessions.list, { limit: 5000 });
      expect(sessionsAfter).toHaveLength(450);
      // Every session—including the 50 on chunk 1—must retain remapped canonical tagId "tag-study"
      expect(sessionsAfter?.every((s) => s.tagId === "tag-study")).toBe(true);

      const userAfter = await asUser.query(api.users.current, {});
      expect(userAfter?.tags.length).toBe(initialTagCount);
    });
  });

  describe("LocalStorageService quota handling & TelemetryRepository trim fallback", () => {
    let store: Map<string, string>;
    let maxBytesPerValue: number;

    beforeEach(() => {
      store = new Map<string, string>();
      maxBytesPerValue = Infinity;
      vi.restoreAllMocks();

      const mockStorage = {
        get length() {
          return store.size;
        },
        key: (index: number) => Array.from(store.keys())[index] ?? null,
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, val: string) => {
          if (val.length > maxBytesPerValue) {
            throw createQuotaError();
          }
          store.set(key, val);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
        clear: () => {
          store.clear();
        },
      };

      Object.defineProperty(globalThis, "localStorage", {
        value: mockStorage,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, "window", {
        value: { localStorage: mockStorage, location: { hostname: "localhost" } },
        configurable: true,
        writable: true,
      });
    });

    it("does NOT throw on QuotaExceededError by default, keeps memoryCache updated, and only throws when throwOnQuotaError is true", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const storage = new LocalStorageService("test:");

      // Trigger quota error on all subsequent writes
      maxBytesPerValue = 5;

      expect(() => storage.setItem("settings", { workDurationMinutes: 25 })).not.toThrow();
      expect(storage.getItem("settings", null)).toEqual({ workDurationMinutes: 25 });
      expect(warnSpy).toHaveBeenCalledTimes(1);

      // Second default write still does not throw and does not spam quota warnings
      expect(() => storage.setItem("tags", ["a", "b", "c"])).not.toThrow();
      expect(storage.getItem("tags", [])).toEqual(["a", "b", "c"]);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      // Opt-in throwOnQuotaError: true rethrows while still updating memoryCache
      expect(() =>
        storage.setItem("telemetry", { big: "payload" }, { throwOnQuotaError: true })
      ).toThrow(/QuotaExceededError/);
      expect(storage.getItem("telemetry", null)).toEqual({ big: "payload" });
    });

    it("TelemetryRepository trims oldest 25% on QuotaExceededError via throwOnQuotaError: true", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const storage = new LocalStorageService("tele:");
      const repo = new TelemetryRepository(storage);

      const events: MlEvent[] = Array.from({ length: 20 }, (_, idx) => ({
        eventId: `evt-${idx}`,
        attemptId: null,
        eventType: "timer_viewed",
        occurredAt: new Date(Date.parse("2026-04-01T00:00:00.000Z") + idx * 1000).toISOString(),
        timestampMs: Date.parse("2026-04-01T00:00:00.000Z") + idx * 1000,
        localDate: "2026-04-01",
        localHour: 9,
        localDayOfWeek: 3,
        sessionType: "WORK",
        tagId: null,
        fromTagId: null,
        toTagId: null,
        remainingSeconds: 1500,
        deltaSeconds: null,
        metadata: { padding: "x".repeat(40) },
      }));

      const fullPayloadSize = JSON.stringify(events).length;
      const reducedPayloadSize = JSON.stringify(events.slice(5)).length;
      // Set quota limit strictly between reduced (75%) and full (100%) payload sizes
      maxBytesPerValue = Math.floor((fullPayloadSize + reducedPayloadSize) / 2);

      await repo.saveEvents(events);

      // Verify localStorage itself persisted the trimmed 75% (15 newest events)
      const persistedRaw = store.get("tele:ml_events_v1");
      expect(persistedRaw).toBeDefined();
      const persisted = JSON.parse(persistedRaw!) as MlEvent[];
      expect(persisted).toHaveLength(15);
      expect(persisted[0].eventId).toBe("evt-5");
      expect(persisted[14].eventId).toBe("evt-19");
    });
  });

  describe("SessionRepository.replaceId & CoffeeRepository.replaceId", () => {
    let store: Map<string, string>;
    let storage: LocalStorageService;

    beforeEach(() => {
      store = new Map<string, string>();
      vi.restoreAllMocks();
      vi.spyOn(envModule, "isProduction").mockReturnValue(true);

      const mockStorage = {
        get length() {
          return store.size;
        },
        key: (index: number) => Array.from(store.keys())[index] ?? null,
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, val: string) => {
          store.set(key, val);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
        clear: () => {
          store.clear();
        },
      };

      Object.defineProperty(globalThis, "localStorage", {
        value: mockStorage,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, "window", {
        value: { localStorage: mockStorage, location: { hostname: "localhost" } },
        configurable: true,
        writable: true,
      });

      storage = new LocalStorageService("repo:");
    });

    it("SessionRepository.replaceId rewrites ID + completedAt, deduplicates existing server ID, and serializes with concurrent adds", async () => {
      const repo = new SessionRepository(storage);

      const local1 = await repo.add({
        id: "session-local-1",
        tagId: "tag-study",
        sessionType: "WORK",
        durationSeconds: 1500,
        completedAt: "2026-04-02T10:00:00.000Z",
      });

      // Concurrent replaceId + add must serialize cleanly without losing either entry
      await Promise.all([
        repo.replaceId(local1.id, "convex-session-1", {
          completedAt: "2026-04-02T10:00:01.000Z",
        }),
        repo.add({
          id: "session-local-2",
          tagId: "tag-work",
          sessionType: "WORK",
          durationSeconds: 1500,
          completedAt: "2026-04-02T10:00:15.000Z",
        }),
      ]);

      let all = await repo.getAll();
      expect(all).toHaveLength(2);
      expect(all.find((s) => s.id === "convex-session-1")?.completedAt).toBe(
        "2026-04-02T10:00:01.000Z"
      );
      expect(all.find((s) => s.id === "session-local-2")).toBeDefined();

      // Dedup case: server deduplicated session-local-2 (within 45s) back to convex-session-1
      await repo.replaceId("session-local-2", "convex-session-1", {
        completedAt: "2026-04-02T10:00:01.000Z",
      });

      all = await repo.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe("convex-session-1");
    });

    it("CoffeeRepository.replaceId serializes with concurrent adds, deduplicates existing IDs, and does not resurrect removed cups", async () => {
      const repo = new CoffeeRepository(storage);

      const cup1 = await repo.addCup("2026-04-02", "tag-study");

      // Concurrent replaceId + addCup must preserve both cups
      const [, cup2] = await Promise.all([
        repo.replaceId(cup1.id, "convex-cup-1"),
        repo.addCup("2026-04-02", "tag-work"),
      ]);

      let all = await repo.getAll();
      expect(all).toHaveLength(2);
      expect(all.some((c) => c.id === "convex-cup-1")).toBe(true);
      expect(all.some((c) => c.id === cup2.id)).toBe(true);

      // Dedup case: replacing cup2's ID with an already-existing server ID drops duplicate
      await repo.replaceId(cup2.id, "convex-cup-1");
      all = await repo.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe("convex-cup-1");

      // Undo-before-reconcile case: removing cup3 then calling replaceId must not resurrect it
      const cup3 = await repo.addCup("2026-04-02", null);
      await repo.removeCup("2026-04-02", null, cup3.id);
      await repo.replaceId(cup3.id, "convex-cup-3");
      all = await repo.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe("convex-cup-1");
    });
  });
});
