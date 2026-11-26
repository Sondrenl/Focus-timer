// @vitest-environment node
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SessionRepository,
  CoffeeRepository,
  TagRepository,
  ProfileRepository,
  sanitizeProfile,
  MAX_AVATAR_EMOJI_LENGTH,
  TelemetryRepository,
} from "../src/services/storage/guestRepositories";
import { sanitizeHexColor, getAlphaColor } from "../src/utils/colors";
import { LocalStorageService } from "../src/services/storage/LocalStorageService";
import { useBackupAndMigration, sanitizeProfileForExport } from "../src/hooks/data/useBackupAndMigration";
import { computeGuestTagMergePlan } from "../src/hooks/data/useCloudMigration";
import { useTagsData } from "../src/hooks/data/useTagsData";
import { DEFAULT_TAGS, Tag } from "../src/types/tag";
import { BackupData, DEFAULT_PROFILE, UserProfile } from "../src/types/user";
import { DEFAULT_SETTINGS } from "../src/types/settings";
import { buildSettingsSnapshot } from "../src/utils/telemetryContext";
import { SessionAttempt } from "../src/types/telemetry";

describe("Guest Repositories, Serialization & Backup Export", () => {
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

  describe("SessionRepository Serialization", () => {
    it("starts empty and serializes concurrent add() calls without dropping sessions", async () => {
      const repo = new SessionRepository(storageService);
      expect(await repo.getAll()).toEqual([]);

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
    it("sanitizeProfileForExport strips email and avatarUrl while preserving displayName, avatarEmoji, and dailyGoalMinutes", () => {
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
      expect(exported.displayName).toBe("Focus Fanatic");
      expect(exported.avatarEmoji).toBe("🧠");
      expect(exported.dailyGoalMinutes).toBe(180);
      expect(exported.email).toBeUndefined();
      expect(exported.avatarUrl).toBeUndefined();
    });

    it("exportBackup() does not leak email or avatarUrl in exported backup data", () => {
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
          isAuthenticated: true,
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
          resetProfileToDefaults: vi.fn(),
          resetSettingsToDefaults: vi.fn(),
          convexSync: {
            isConvexConfigured: false,
            convexUser: null,
            convexCoffee: [],
            convexSessions: [],
            mutations: {} as any,
          } as any,
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
      expect(exportedBackupData!.version).toBe("3.1.0");

      const exportedProfile = exportedBackupData!.profile as any;
      expect(exportedProfile.email).toBeUndefined();
      expect(exportedProfile.avatarUrl).toBeUndefined();

      const jsonBackup = JSON.stringify(exportedBackupData);
      expect(jsonBackup).not.toContain("confidential_person@domain.com");
      expect(jsonBackup).not.toContain("ACg8ocPrivateProfilePhoto");
    });
  });

  describe("Storage Quota, Deduplication & ZWJ Emoji", () => {
    it("deduplicates SessionRepository.add by timerRunId and supports 32-char ZWJ avatarEmoji", async () => {
      const sessRepo = new SessionRepository(storageService);
      const first = await sessRepo.add({
        tagId: null,
        sessionType: "WORK",
        durationSeconds: 1500,
        completedAt: "2026-04-01T10:00:00.000Z",
        timerRunId: "run-dup",
      });
      const second = await sessRepo.add({
        tagId: null,
        sessionType: "WORK",
        durationSeconds: 1500,
        completedAt: "2026-04-01T10:05:00.000Z",
        timerRunId: "run-dup",
      });
      expect(second.id).toBe(first.id);
      expect(await sessRepo.getAll()).toHaveLength(1);

      const zwjEmoji = "👩‍❤️‍💋‍👨👨‍💻";
      expect(MAX_AVATAR_EMOJI_LENGTH).toBe(32);
      expect(sanitizeProfile({ avatarEmoji: "a".repeat(50) }).avatarEmoji).toHaveLength(32);

      const profileRepo = new ProfileRepository(storageService);
      await profileRepo.save({ ...DEFAULT_PROFILE, displayName: "   ", avatarEmoji: ` ${zwjEmoji} ` });
      const loaded = await profileRepo.get();
      expect(loaded.avatarEmoji).toBe(zwjEmoji);
      expect(loaded.displayName).toBe(DEFAULT_PROFILE.displayName);
    });

    it("handles LocalStorageService QuotaExceededError, trims TelemetryRepository oldest 25%, and invalidates memoryCache on storage event", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      let maxBytes = 5;
      const listeners: Array<(e: any) => void> = [];
      const quotaStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          if (v.length > maxBytes) {
            const err = new Error("QuotaExceededError");
            err.name = "QuotaExceededError";
            throw err;
          }
          store.set(k, v);
        },
        removeItem: (k: string) => store.delete(k),
        clear: () => store.clear(),
      };
      Object.defineProperty(globalThis, "localStorage", { value: quotaStorage, configurable: true, writable: true });
      Object.defineProperty(globalThis, "window", {
        value: {
          localStorage: quotaStorage,
          location: { hostname: "localhost" },
          addEventListener: (ev: string, fn: any) => { if (ev === "storage") listeners.push(fn); },
          removeEventListener: () => {},
        },
        configurable: true,
        writable: true,
      });

      const ls = new LocalStorageService("quota:");
      expect(() => ls.setItem("k1", { v: "mem-only" })).not.toThrow();
      expect(ls.getItem("k1", null)).toEqual({ v: "mem-only" });
      expect(() => ls.setItem("k2", { big: "payload" }, { throwOnQuotaError: true })).toThrow(/QuotaExceededError/);

      // Peer-tab storage event invalidates memoryCache
      maxBytes = Infinity;
      store.set("quota:k1", JSON.stringify({ v: "peer-fresh" }));
      listeners.forEach((fn) => fn({ key: "quota:k1", newValue: JSON.stringify({ v: "peer-fresh" }) }));
      expect(ls.getItem("k1", null)).toEqual({ v: "peer-fresh" });

      // TelemetryRepository trims oldest 25% on QuotaExceededError
      const teleRepo = new TelemetryRepository(new LocalStorageService("tele:"));
      const attempts: SessionAttempt[] = Array.from({ length: 20 }, (_, idx) => ({
        attemptId: `att-${idx}`,
        sessionType: "WORK",
        status: "completed",
        wasStarted: true,
        plannedDurationSeconds: 1500,
        actualActiveSeconds: 1500,
        remainingSecondsAtEnd: 0,
        completionRatio: 1,
        startedAt: new Date(Date.parse("2026-04-01T00:00:00.000Z") + idx * 1000).toISOString(),
        endedAt: new Date(Date.parse("2026-04-01T00:25:00.000Z") + idx * 1000).toISOString(),
        utcOffsetMinutes: 0,
        localDate: "2026-04-01",
        localHour: 9,
        localMinuteOfDay: 540,
        localDayOfWeek: 3,
        cycleIndex: 1,
        longBreakInterval: 4,
        autoStarted: false,
        initialTagId: null,
        tagId: null,
        tagChangedMidRun: false,
        pauseCount: 0,
        totalPausedSeconds: 0,
        pauseIntervals: [],
        dailyGoalMinutes: 120,
        settingsSnapshot: buildSettingsSnapshot(DEFAULT_SETTINGS),
        deviceClass: "desktop",
        tabBackgroundedCount: 0,
        completionLatencySeconds: 0,
        source: "client",
        updatedAtMs: Date.parse("2026-04-01T00:25:00.000Z") + idx * 1000,
      }));
      maxBytes = Math.floor((JSON.stringify(attempts).length + JSON.stringify(attempts.slice(5)).length) / 2);
      await teleRepo.saveAttempts(attempts);
      const persisted = JSON.parse(store.get("tele:ml_attempts_v1")!) as SessionAttempt[];
      expect(persisted).toHaveLength(15);
      expect(persisted[0].attemptId).toBe("att-5");
    });
  });

  describe("Deleted Tag Resurrection Prevention", () => {
    it("does not resurrect deleted default tags even when referenced by guest sessions", () => {
      const deletedDefault = DEFAULT_TAGS[0]; // tag-deep-work
      const remoteTags = DEFAULT_TAGS.filter((t) => t.id !== deletedDefault.id);

      const plan = computeGuestTagMergePlan({
        localTags: DEFAULT_TAGS,
        remoteTags,
        referencedTagIds: new Set([deletedDefault.id]),
        guestModifiedFlag: true,
      });

      expect(plan.tagsToMerge).toEqual([]);
      expect(plan.remoteTagIds.has(deletedDefault.id)).toBe(false);
    });

    it("remaps an untouched default tag to a renamed remote tag with the same ID without duplicating", () => {
      const renamedRemote: Tag = {
        ...DEFAULT_TAGS[0],
        name: "Focused Flow",
      };
      const remoteTags = [renamedRemote, ...DEFAULT_TAGS.slice(1)];

      const plan = computeGuestTagMergePlan({
        localTags: DEFAULT_TAGS,
        remoteTags,
        referencedTagIds: new Set([DEFAULT_TAGS[0].id]),
        guestModifiedFlag: true,
      });

      expect(plan.tagsToMerge).toEqual([]);
      expect(plan.localTagIdRemap.get(DEFAULT_TAGS[0].id)).toBe(renamedRemote.id);
    });

    it("does not resurrect stale unowned custom tags when guestModifiedFlag is false", () => {
      const staleDeletedCustom: Tag = {
        id: "tag-deleted-custom",
        name: "Old Project",
        color: "#EF4444",
        isArchived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      };

      const plan = computeGuestTagMergePlan({
        localTags: [...DEFAULT_TAGS, staleDeletedCustom],
        remoteTags: DEFAULT_TAGS,
        referencedTagIds: new Set(),
        guestModifiedFlag: false,
      });

      expect(plan.tagsToMerge).toEqual([]);
    });

    it("merges genuinely created guest custom tags and mints a fresh ID on remote ID collision", () => {
      const collidingCustom: Tag = {
        id: "tag-study",
        name: "Quantum Physics",
        color: "#8B5CF6",
        isArchived: false,
        createdAt: "2026-03-01T00:00:00.000Z",
      };

      const plan = computeGuestTagMergePlan({
        localTags: [collidingCustom],
        remoteTags: DEFAULT_TAGS,
        referencedTagIds: new Set(),
        guestModifiedFlag: true,
      });

      expect(plan.tagsToMerge).toHaveLength(1);
      expect(plan.tagsToMerge[0].name).toBe("Quantum Physics");
      expect(plan.tagsToMerge[0].id).not.toBe("tag-study");
      expect(plan.localTagIdRemap.get("tag-study")).toBe(plan.tagsToMerge[0].id);
    });

    it("returns an empty tag list in cloud mode while convexUser is still loading instead of DEFAULT_TAGS", () => {
      let capturedTags: Tag[] = [];
      const Probe = () => {
        const { tags } = useTagsData({
          isAuthenticated: true,
          isLoggingOut: false,
          convexSync: {
            isConvexConfigured: true,
            isConvexConnected: false,
            convexUser: undefined,
            convexCoffee: undefined,
            convexSessions: undefined,
            vapidPublicKey: undefined,
            devicePushStatus: undefined,
            mutations: {} as never,
          },
          setSessions: vi.fn(),
          setCoffeeCups: vi.fn(),
        });
        capturedTags = tags;
        return null;
      };

      renderToStaticMarkup(React.createElement(Probe));
      expect(capturedTags).toEqual([]);
    });
  });
});
