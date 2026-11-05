// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { SessionRepository, isSampleSessionId } from "../src/services/repository/SessionRepository";
import { CoffeeRepository } from "../src/services/repository/CoffeeRepository";
import { TagRepository } from "../src/services/repository/TagRepository";
import { LocalStorageService } from "../src/services/storage/LocalStorageService";
import * as envModule from "../src/utils/environment";

describe("Repository Serialization & Sample Data Isolation", () => {
  const store = new Map<string, string>();
  let storageService: LocalStorageService;

  beforeEach(() => {
    store.clear();
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, val: string) => store.set(key, val),
        removeItem: (key: string) => store.delete(key),
        clear: () => store.clear(),
      },
      configurable: true,
      writable: true,
    });
    storageService = new LocalStorageService();
  });

  describe("SessionRepository & Sample Data Isolation", () => {
    it("identifies sample-* and seed-* session IDs accurately", () => {
      expect(isSampleSessionId("sample-0-1-12345")).toBe(true);
      expect(isSampleSessionId("seed-99")).toBe(true);
      expect(isSampleSessionId("session-1710000000-abc")).toBe(false);
    });

    it("seeds sample sessions on empty storage in dev/preview mode (!isProduction)", async () => {
      vi.spyOn(envModule, "isProduction").mockReturnValue(false);
      const repo = new SessionRepository(storageService);

      const sessions = await repo.getAll();
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.every((s) => isSampleSessionId(s.id))).toBe(true);
    });

    it("NEVER seeds sample sessions in production mode (isProduction)", async () => {
      vi.spyOn(envModule, "isProduction").mockReturnValue(true);
      const repo = new SessionRepository(storageService);

      const sessions = await repo.getAll();
      expect(sessions).toEqual([]);
    });

    it("strips any leaked sample sessions automatically when getAll() runs in production", async () => {
      vi.spyOn(envModule, "isProduction").mockReturnValue(false);
      const repo = new SessionRepository(storageService);
      await repo.loadSampleData();
      const realSession = await repo.add({
        tagId: "tag-study",
        sessionType: "WORK",
        durationSeconds: 1500,
        completedAt: "2026-03-10T10:00:00.000Z",
      });

      const devSessions = await repo.getAll();
      expect(devSessions.some((s) => isSampleSessionId(s.id))).toBe(true);

      // Switch to production environment
      vi.spyOn(envModule, "isProduction").mockReturnValue(true);
      const prodSessions = await repo.getAll();
      expect(prodSessions).toHaveLength(1);
      expect(prodSessions[0].id).toBe(realSession.id);
    });

    it("purges sample sessions when user logs into their account on a dev build while preserving real sessions", async () => {
      vi.spyOn(envModule, "isProduction").mockReturnValue(false);
      const repo = new SessionRepository(storageService);

      // Initial dev seed + 1 real user session
      const initial = await repo.getAll();
      expect(initial.some((s) => isSampleSessionId(s.id))).toBe(true);

      const real = await repo.add({
        tagId: "tag-work",
        sessionType: "WORK",
        durationSeconds: 1800,
        completedAt: "2026-03-15T14:00:00.000Z",
      });

      const remaining = await repo.purgeSampleSessions();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(real.id);
      expect(remaining.some((s) => isSampleSessionId(s.id))).toBe(false);

      // Subsequent getAll() does not re-seed because SESSIONS_SEEDED_KEY is set
      const afterPurge = await repo.getAll();
      expect(afterPurge).toHaveLength(1);
      expect(afterPurge[0].id).toBe(real.id);
    });

    it("serializes concurrent add() calls without dropping sessions", async () => {
      vi.spyOn(envModule, "isProduction").mockReturnValue(true);
      const repo = new SessionRepository(storageService);

      await Promise.all(
        Array.from({ length: 10 }, (_, idx) =>
          repo.add({
            tagId: "tag-study",
            sessionType: "WORK",
            durationSeconds: 1500,
            completedAt: new Date(Date.UTC(2026, 2, 10, 10, idx, 0)).toISOString(),
          }),
        ),
      );

      const all = await repo.getAll();
      expect(all).toHaveLength(10);
    });
  });

  describe("CoffeeRepository Serialization", () => {
    it("serializes concurrent addCup() and removeCup() calls accurately", async () => {
      const repo = new CoffeeRepository(storageService);

      await Promise.all([
        repo.addCup("2026-03-10", "tag-study"),
        repo.addCup("2026-03-10", "tag-work"),
        repo.addCup("2026-03-10", "tag-exercise"),
        repo.addCup("2026-03-10", null),
      ]);

      const afterAdd = await repo.getAll();
      expect(afterAdd).toHaveLength(4);

      await Promise.all([repo.removeCup("2026-03-10"), repo.removeCup("2026-03-10")]);
      const afterRemove = await repo.getAll();
      expect(afterRemove).toHaveLength(2);
    });
  });

  describe("TagRepository Serialization", () => {
    it("serializes concurrent create(), update(), and delete() calls without race conditions", async () => {
      const repo = new TagRepository(storageService);

      const created = await Promise.all([
        repo.create({ name: "Math", color: "#EF4444" }),
        repo.create({ name: "Physics", color: "#3B82F6" }),
        repo.create({ name: "Writing", color: "#10B981" }),
      ]);

      await Promise.all([
        repo.update(created[0].id, { name: "Advanced Math" }),
        repo.delete(created[1].id),
      ]);

      const allTags = await repo.getAll();
      expect(allTags.some((t) => t.id === created[0].id && t.name === "Advanced Math")).toBe(true);
      expect(allTags.some((t) => t.id === created[1].id)).toBe(false);
      expect(allTags.some((t) => t.id === created[2].id && t.name === "Writing")).toBe(true);
    });
  });
});
