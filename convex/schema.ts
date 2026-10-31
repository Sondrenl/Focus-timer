import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // 1. Unified User Document: Profile + Preferences combined
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
  }).index("by_token", ["tokenIdentifier"]),

  // 2. Active Timer: Dedicated for sub-50ms reactive isolation + peer presence
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

  // 3. Tags: Independent entities referenced by tagId
  tags: defineTable({
    userId: v.id("users"),
    name: v.string(),
    color: v.string(),
    isArchived: v.boolean(),
    createdAt: v.string(),
    updatedAt: v.optional(v.string()),
  }).index("by_user", ["userId"]),

  // 4. Completed Sessions: Historical log
  sessions: defineTable({
    userId: v.id("users"),
    tagId: v.optional(v.string()),
    sessionType: v.union(
      v.literal("WORK"),
      v.literal("SHORT_BREAK"),
      v.literal("LONG_BREAK")
    ),
    durationSeconds: v.number(),
    completedAt: v.string(), // ISO string with time for peak hour analytics
    date: v.string(),        // "YYYY-MM-DD" for fast indexed date range lookups
  })
    .index("by_user", ["userId"])
    .index("by_user_date", ["userId", "date"])
    .index("by_user_completed", ["userId", "completedAt"]),

  // 5. Coffee Log: Individual timestamped cups
  coffee_cups: defineTable({
    userId: v.id("users"),
    tagId: v.optional(v.string()),
    date: v.string(),        // "YYYY-MM-DD"
    createdAt: v.string(),
    timestamp: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_date", ["userId", "date"]),
});
