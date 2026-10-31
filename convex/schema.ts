import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // 1. User: Profile + Preferences + Embedded Tags (All core state in 1 query)
  users: defineTable({
    tokenIdentifier: v.string(),
    email: v.string(),
    displayName: v.string(),
    avatarUrl: v.optional(v.string()),
    avatarEmoji: v.string(),
    dailyGoalMinutes: v.number(),
    createdAt: v.string(),
    settings: v.object({
      workDurationMinutes: v.number(),
      shortBreakDurationMinutes: v.number(),
      longBreakDurationMinutes: v.number(),
      longBreakInterval: v.number(),
      autoStartBreaks: v.boolean(),
      autoStartPomodoros: v.boolean(),
      soundVolume: v.number(),
      soundEnabled: v.boolean(),
      notificationsEnabled: v.boolean(),
      keepAwake: v.boolean(),
      updatedAt: v.string(),
    }),
    tags: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        color: v.string(),
        isArchived: v.boolean(),
        createdAt: v.string(),
        updatedAt: v.optional(v.string()),
      })
    ),
  }).index("by_token", ["tokenIdentifier"]),

  // 2. Active Timer: Dedicated for sub-50ms sync & peer presence
  active_timers: defineTable({
    userId: v.id("users"),
    sessionType: v.union(
      v.literal("WORK"),
      v.literal("SHORT_BREAK"),
      v.literal("LONG_BREAK")
    ),
    status: v.union(
      v.literal("IDLE"),
      v.literal("RUNNING"),
      v.literal("PAUSED"),
      v.literal("COMPLETED")
    ),
    remainingSeconds: v.number(),
    totalSeconds: v.number(),
    targetEndTime: v.optional(v.number()), // Server anchor timestamp in ms
    currentCycle: v.number(),
    tagId: v.optional(v.string()),
    timerRunId: v.optional(v.string()),
    updatedAtMs: v.number(),
    scheduledCompletionId: v.optional(v.id("_scheduled_functions")),
    peerPresence: v.optional(
      v.object({
        desktopActive: v.boolean(),
        desktopVisible: v.boolean(),
        mobileActive: v.boolean(),
        mobileVisible: v.boolean(),
        lastSeenMs: v.number(),
      })
    ),
  }).index("by_user", ["userId"]),

  // 3. Completed Sessions: Historical log with ISO timestamps
  sessions: defineTable({
    userId: v.id("users"),
    tagId: v.optional(v.string()),
    sessionType: v.union(
      v.literal("WORK"),
      v.literal("SHORT_BREAK"),
      v.literal("LONG_BREAK")
    ),
    durationSeconds: v.number(),
    completedAt: v.string(), // Lexicographically sortable ISO-8601 string
  })
    .index("by_user", ["userId"])
    .index("by_user_completed", ["userId", "completedAt"]),

  // 4. Coffee Log: Individual timestamped cups
  coffee_cups: defineTable({
    userId: v.id("users"),
    tagId: v.optional(v.string()),
    date: v.string(), // "YYYY-MM-DD"
    createdAt: v.string(), // ISO-8601
  })
    .index("by_user", ["userId"])
    .index("by_user_date", ["userId", "date"]),

  // 5. Multi-Device Push Subscriptions (For background lock-screen notifications)
  push_subscriptions: defineTable({
    userId: v.id("users"),
    deviceId: v.string(),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    userAgent: v.optional(v.string()),
    updatedAt: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_user_device", ["userId", "deviceId"]),
});
