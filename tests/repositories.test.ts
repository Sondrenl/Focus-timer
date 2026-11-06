// @vitest-environment node
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { SessionRepository, isSampleSessionId } from "../src/services/repository/SessionRepository";
import { CoffeeRepository } from "../src/services/repository/CoffeeRepository";
import { TagRepository } from "../src/services/repository/TagRepository";
import { ProfileRepository, sanitizeProfile } from "../src/services/repository/ProfileRepository";
import { sanitizeHexColor, getAlphaColor } from "../src/utils/colors";
import { LocalStorageService } from "../src/services/storage/LocalStorageService";
import * as envModule from "../src/utils/environment";
import { useBackupAndMigration, sanitizeProfileForExport } from "../src/hooks/data/useBackupAndMigration";
import { BackupData, UserProfile } from "../src/types/user";

describe("Repository Serialization & Sample Data Isolation", () => {
  const store = new Map<string, string>();
  let storageService: LocalStorageService;

  beforeEach(() => {
    store.clear();
    vi.restoreAllMocks();
    const mockStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => store.set(key, val),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
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

    it("enforces tag name length ceiling, color sanitization, and non-empty checks", async () => {
      const repo = new TagRepository(storageService);

      await expect(repo.create({ name: "   ", color: "#3B82F6" })).rejects.toThrow("Tag name cannot be empty.");

      const longTag = await repo.create({
        name: "A".repeat(80),
        color: "invalid-color-value",
      });
      expect(longTag.name).toHaveLength(50);
      expect(longTag.color).toBe("#7E57C2"); // Default fallback in TagRepository.create

      // getAll() auto-migrates existing corrupt records in storage
      storageService.setItem("tags_v1", [
        {
          id: "tag-bad",
          name: "B".repeat(100),
          color: "javascript:alert(1)",
          isArchived: false,
        },
      ]);
      const retrieved = await repo.getAll();
      expect(retrieved[0].name).toHaveLength(50);
      expect(retrieved[0].color).toBe("#3B82F6"); // Default fallback in sanitizeHexColor
    });

    it("enforces maximum tag count quota (100 tags)", async () => {
      const repo = new TagRepository(storageService);
      const tags = Array.from({ length: 100 }, (_, i) => ({
        id: `tag-${i}`,
        name: `Tag ${i}`,
        color: "#3B82F6",
        isArchived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
      storageService.setItem("tags_v1", tags);

      await expect(repo.create({ name: "Overflow Tag", color: "#3B82F6" })).rejects.toThrow(
        "Maximum limit of 100 tags reached."
      );
    });
  });

  describe("ProfileRepository & User Data Sanitization", () => {
    it("sanitizes displayName, clamps dailyGoalMinutes, and rejects non-https avatarUrl", async () => {
      const repo = new ProfileRepository(storageService);

      await repo.save({
        displayName: "  Very Long Name ".repeat(10),
        avatarEmoji: "🎯🔥",
        dailyGoalMinutes: 99999,
        avatarUrl: "http://insecure-domain.com/avatar.png",
        createdAt: new Date().toISOString(),
      });

      const profile = await repo.get();
      expect(profile.displayName.length).toBeLessThanOrEqual(50);
      expect(profile.dailyGoalMinutes).toBe(1440); // Clamped to 24h
      expect(profile.avatarUrl).toBeUndefined(); // Insecure http stripped

      // With valid https avatarUrl
      await repo.save({
        ...profile,
        avatarUrl: "https://lh3.googleusercontent.com/photo.jpg",
        dailyGoalMinutes: -50,
      });
      const updated = await repo.get();
      expect(updated.avatarUrl).toBe("https://lh3.googleusercontent.com/photo.jpg");
      expect(updated.dailyGoalMinutes).toBe(120); // Fallback to default 120 on non-positive
    });
  });

  describe("Color Utilities (colors.ts)", () => {
    it("sanitizes hex color inputs and avoids invalid CSS shorthand expansion", () => {
      expect(sanitizeHexColor("#fff")).toBe("#fff");
      expect(sanitizeHexColor("#3B82F6")).toBe("#3B82F6");
      expect(sanitizeHexColor("#10B981FF")).toBe("#10B981FF");
      expect(sanitizeHexColor("red")).toBe("#3B82F6");
      expect(sanitizeHexColor("rgb(0,0,0)")).toBe("#3B82F6");
      expect(sanitizeHexColor("")).toBe("#3B82F6");
      expect(sanitizeHexColor(null)).toBe("#3B82F6");

      // getAlphaColor properly expands 3-digit hex to avoid generating 5-digit invalid CSS hex
      expect(getAlphaColor("#fff", "25")).toBe("#ffffff25");
      expect(getAlphaColor("#3B82F6", "25")).toBe("#3B82F625");
      expect(getAlphaColor("invalid", "25")).toBe("#3B82F625");
    });
  });

  describe("Exported Backup Privacy & PII Sanitization", () => {
    it("sanitizeProfileForExport strips id, email, and avatarUrl while preserving displayName, avatarEmoji, and dailyGoalMinutes", () => {
      const fullProfile: UserProfile = {
        id: "convex-user-private-id",
        email: "private.user@gmail.com",
        avatarUrl: "https://lh3.googleusercontent.com/sensitive-photo.jpg",
        displayName: "Focus Fanatic",
        avatarEmoji: "🧠",
        dailyGoalMinutes: 180,
        createdAt: "2026-01-01T12:00:00.000Z",
      };

      const exported = sanitizeProfileForExport(fullProfile);
      expect(exported).toEqual({
        displayName: "Focus Fanatic",
        avatarEmoji: "🧠",
        dailyGoalMinutes: 180,
      });
      expect((exported as any).id).toBeUndefined();
      expect((exported as any).email).toBeUndefined();
      expect((exported as any).avatarUrl).toBeUndefined();
      expect((exported as any).createdAt).toBeUndefined();
    });

    it("sanitizeProfileForExport returns undefined when profile is undefined or null", () => {
      expect(sanitizeProfileForExport(undefined)).toBeUndefined();
      expect(sanitizeProfileForExport(null)).toBeUndefined();
    });

    it("exportBackup() does not leak email, account id, or avatarUrl in exported backup data", () => {
      let exportedBackupData: BackupData | null = null;

      const profileWithPII: UserProfile = {
        id: "usr_secret_account_id_99999",
        email: "confidential_person@domain.com",
        avatarUrl: "https://lh3.googleusercontent.com/a/ACg8ocPrivateProfilePhoto",
        displayName: "Private Practitioner",
        avatarEmoji: "🎯",
        dailyGoalMinutes: 90,
        createdAt: "2026-03-01T08:00:00.000Z",
      };

      function HookHarness() {
        const { exportBackup } = useBackupAndMigration({
          isEffectiveAuthenticated: true,
          profile: profileWithPII,
          settings: {
            workDurationMinutes: 25,
            shortBreakDurationMinutes: 5,
            longBreakDurationMinutes: 15,
            longBreakInterval: 4,
            soundVolume: 0.7,
            soundEnabled: true,
            notificationsEnabled: true,
            autoStartBreaks: false,
            autoStartPomodoros: false,
            keepAwake: false,
          },
          updateProfile: vi.fn(),
          updateSettings: vi.fn(),
          resetProfileToDefaults: vi.fn(),
          resetSettingsToDefaults: vi.fn(),
          convexSync: {
            isConvexConfigured: false,
            convexUser: null,
            convexCoffee: [],
            convexSessions: [],
            mutations: {
              importBackup: vi.fn(),
            } as any,
          },
          tags: [
            {
              id: "tag-1",
              name: "Focus",
              color: "#3B82F6",
              isArchived: false,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          setTags: vi.fn(),
          activeTagId: null,
          setActiveTagId: vi.fn(),
          sessions: [],
          setSessions: vi.fn(),
          coffeeCups: [],
          setCoffeeCups: vi.fn(),
        });

        exportedBackupData = exportBackup();
        return null;
      }

      renderToStaticMarkup(React.createElement(HookHarness));

      expect(exportedBackupData).not.toBeNull();
      expect(exportedBackupData!.version).toBe("3.0.1");

      // Verify profile is present but sanitized
      expect(exportedBackupData!.profile).toBeDefined();
      expect(exportedBackupData!.profile).toEqual({
        displayName: "Private Practitioner",
        avatarEmoji: "🎯",
        dailyGoalMinutes: 90,
      });

      // Explicitly verify sensitive PII fields are omitted
      const exportedProfile = exportedBackupData!.profile as any;
      expect(exportedProfile.id).toBeUndefined();
      expect(exportedProfile.email).toBeUndefined();
      expect(exportedProfile.avatarUrl).toBeUndefined();
      expect(exportedProfile.createdAt).toBeUndefined();

      // Verify serialized JSON export does not contain any leaked PII strings
      const jsonBackup = JSON.stringify(exportedBackupData);
      expect(jsonBackup).not.toContain("confidential_person@domain.com");
      expect(jsonBackup).not.toContain("usr_secret_account_id_99999");
      expect(jsonBackup).not.toContain("ACg8ocPrivateProfilePhoto");
    });

    it("importBackup() correctly handles both sanitized exports and legacy exports with id/email", async () => {
      let importBackupFn: any = null;
      const mockUpdateProfile = vi.fn();

      function HookHarness() {
        const { importBackup } = useBackupAndMigration({
          isEffectiveAuthenticated: true,
          profile: {
            id: "current-user-id",
            email: "current-user@example.com",
            displayName: "Current User",
            avatarEmoji: "🦉",
            dailyGoalMinutes: 120,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          settings: {
            workDurationMinutes: 25,
            shortBreakDurationMinutes: 5,
            longBreakDurationMinutes: 15,
            longBreakInterval: 4,
            soundVolume: 0.7,
            soundEnabled: true,
            notificationsEnabled: true,
            autoStartBreaks: false,
            autoStartPomodoros: false,
            keepAwake: false,
          },
          updateProfile: mockUpdateProfile,
          updateSettings: vi.fn(),
          resetProfileToDefaults: vi.fn(),
          resetSettingsToDefaults: vi.fn(),
          convexSync: {
            isConvexConfigured: false,
            convexUser: null,
            convexCoffee: [],
            convexSessions: [],
            mutations: {
              importBackup: vi.fn(),
            } as any,
          },
          tags: [],
          setTags: vi.fn(),
          activeTagId: null,
          setActiveTagId: vi.fn(),
          sessions: [],
          setSessions: vi.fn(),
          coffeeCups: [],
          setCoffeeCups: vi.fn(),
        });

        importBackupFn = importBackup;
        return null;
      }

      renderToStaticMarkup(React.createElement(HookHarness));

      // 1. Test importing a sanitized export (without id, email, or avatarUrl)
      const sanitizedBackup: BackupData = {
        version: "3.0.1",
        exportedAt: new Date().toISOString(),
        profile: {
          displayName: "Imported Practitioner",
          avatarEmoji: "🚀",
          dailyGoalMinutes: 150,
        },
        tags: [],
        sessions: [],
      };

      await importBackupFn(sanitizedBackup, "merge");
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        displayName: "Imported Practitioner",
        avatarEmoji: "🚀",
        dailyGoalMinutes: 150,
      });

      // 2. Test importing a legacy backup containing legacy id, email, and avatarUrl
      mockUpdateProfile.mockClear();
      const legacyBackup: BackupData = {
        version: "2.0.0",
        exportedAt: new Date().toISOString(),
        profile: {
          id: "attacker-or-legacy-id-888",
          email: "attacker-or-legacy@example.com",
          displayName: "Legacy Practitioner",
          avatarEmoji: "⚡",
          dailyGoalMinutes: 60,
          avatarUrl: "https://lh3.googleusercontent.com/legacy-photo.jpg",
          createdAt: "2025-01-01T00:00:00.000Z",
        } as any,
        tags: [],
        sessions: [],
      };

      await importBackupFn(legacyBackup, "merge");
      // Must NOT include id or email in the profile update
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        displayName: "Legacy Practitioner",
        avatarEmoji: "⚡",
        dailyGoalMinutes: 60,
      });
      const updatePayload = mockUpdateProfile.mock.calls[0][0];
      expect(updatePayload.id).toBeUndefined();
      expect(updatePayload.email).toBeUndefined();
    });
  });
});

