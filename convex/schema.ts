import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    email: v.string(),
    displayName: v.string(),
    avatarUrl: v.optional(v.string()),
    avatarEmoji: v.string(),
    dailyGoalMinutes: v.number(),
    createdAt: v.string(),
  }).index("by_token", ["tokenIdentifier"]),

  user_settings: defineTable({
    userId: v.id("users"),
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
  }).index("by_user", ["userId"]),

  tags: defineTable({
    userId: v.id("users"),
    name: v.string(),
    color: v.string(),
    isArchived: v.boolean(),
    createdAt: v.string(),
    updatedAt: v.optional(v.string()),
  }).index("by_user", ["userId"]),

  sessions: defineTable({
    userId: v.id("users"),
    tagId: v.optional(v.string()),
    sessionType: v.union(
      v.literal("WORK"),
      v.literal("SHORT_BREAK"),
      v.literal("LONG_BREAK")
    ),
    durationSeconds: v.number(),
    completedAt: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_user_date", ["userId", "completedAt"]),

  coffee_cups: defineTable({
    userId: v.id("users"),
    tagId: v.optional(v.string()),
    date: v.string(),
    createdAt: v.string(),
    timestamp: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_date", ["userId", "date"]),

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
    targetEndTime: v.optional(v.number()),
    currentCycle: v.number(),
    tagId: v.optional(v.string()),
    timerRunId: v.optional(v.string()),
    updatedAtMs: v.number(),
    scheduledCompletionId: v.optional(v.id("_scheduled_functions")),
  }).index("by_user", ["userId"]),

  device_presence: defineTable({
    userId: v.id("users"),
    deviceId: v.string(),
    deviceType: v.string(),
    isVisible: v.boolean(),
    lastSeenMs: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_device", ["userId", "deviceId"]),
});
