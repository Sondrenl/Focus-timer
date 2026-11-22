import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import { sessionAttemptDbFields, mlEventDbFields } from "./telemetryValidators";

export default defineSchema({
  ...authTables,

  // 1. User: Profile + Preferences + Embedded Tags (All core state in 1 query)
  users: defineTable({
    // Convex Auth schema fields
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),

    // Focus Timer application fields
    tokenIdentifier: v.optional(v.string()),
    displayName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    avatarEmoji: v.optional(v.string()),
    dailyGoalMinutes: v.optional(v.number()),
    createdAt: v.optional(v.string()),
    lastTestPushAtMs: v.optional(v.number()),
    settings: v.optional(
      v.object({
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
      })
    ),
    tags: v.optional(
      v.array(
        v.object({
          id: v.string(),
          name: v.string(),
          color: v.string(),
          isArchived: v.boolean(),
          createdAt: v.string(),
          updatedAt: v.optional(v.string()),
        })
      )
    ),
  })
    .index("email", ["email"])
    .index("by_token", ["tokenIdentifier"]),

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
        desktopLastSeenMs: v.optional(v.number()),
        mobileLastSeenMs: v.optional(v.number()),
      })
    ),
  }).index("by_user", ["userId"]),

  // 3. Completed Sessions: Historical log
  // Compound index on ["userId", "completedAt"] covers both userId-only queries and date-range queries
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
    .index("by_user_completed", ["userId", "completedAt"])
    .index("by_user_tag", ["userId", "tagId"]),

  // 4. Coffee Log: Individual timestamped cups
  // Compound index on ["userId", "date"] covers both userId-only queries and date queries
  coffee_cups: defineTable({
    userId: v.id("users"),
    tagId: v.optional(v.string()),
    date: v.string(), // "YYYY-MM-DD"
    createdAt: v.string(), // ISO-8601
  })
    .index("by_user_date", ["userId", "date"])
    .index("by_user_tag", ["userId", "tagId"]),

  // 5. Multi-Device Push Subscriptions (For background lock-screen notifications)
  // Compound index on ["userId", "deviceId"] covers both userId-only queries and specific device lookups
  push_subscriptions: defineTable({
    userId: v.id("users"),
    deviceId: v.string(),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    userAgent: v.optional(v.string()),
    isMobile: v.optional(v.boolean()),
    origin: v.optional(v.string()),
    updatedAt: v.string(),
  })
    .index("by_user_device", ["userId", "deviceId"])
    .index("by_endpoint", ["endpoint"]),

  // 6. Passive ML Telemetry: Run-level session attempts
  session_attempts: defineTable({
    userId: v.id("users"),
    ...sessionAttemptDbFields,
  })
    .index("by_user_attempt", ["userId", "attemptId"])
    .index("by_user_ended", ["userId", "endedAt"])
    .index("by_user_local_date", ["userId", "localDate"])
    .index("by_user_tag", ["userId", "tagId"])
    .index("by_user_initial_tag", ["userId", "initialTagId"]),

  // 7. Passive ML Telemetry: Granular timestamped behavioral events
  ml_events: defineTable({
    userId: v.id("users"),
    ...mlEventDbFields,
  })
    .index("by_user_event", ["userId", "eventId"])
    .index("by_user_timestamp", ["userId", "timestampMs"])
    .index("by_user_local_date", ["userId", "localDate"]),
});

