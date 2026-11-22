import { v } from "convex/values";
import { mutation, internalMutation, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { requireUser, DEFAULT_TAGS } from "./authHelper";
import { assertValidTagId } from "./timerHelpers";

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
export const MAX_TAGS_PER_USER = 100;
export const MAX_TAG_NAME_LENGTH = 50;

// Keep per-transaction reads and writes safely under Convex limits (16,384 reads / 4,096 writes)
const TAG_CLEANUP_BATCH_SIZE = 500;
const RESET_CONTINUATION_PAGE_SIZE = 1000;
const DEFAULT_TAG_ID_SET = new Set(DEFAULT_TAGS.map((t) => t.id));

const resetCleanupStageValidator = v.union(
  v.literal("sessions"),
  v.literal("coffee_cups"),
  v.literal("session_attempts"),
  v.literal("ml_events")
);

export function sanitizeTagColor(color: string): string {
  const trimmed = color.trim();
  return HEX_COLOR_REGEX.test(trimmed) ? trimmed : "#6B7280";
}

export function validateTagName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("Tag name cannot be empty.");
  }
  if (trimmed.length > MAX_TAG_NAME_LENGTH) {
    throw new Error(`Tag name cannot exceed ${MAX_TAG_NAME_LENGTH} characters.`);
  }
  return trimmed;
}

async function clearRemovedTagBatch(
  ctx: MutationCtx,
  params: {
    userId: Id<"users">;
    tagId: string;
    mlEventsCursor: string | null;
    mlEventsDone: boolean;
  }
): Promise<{ hasMore: boolean; nextMlEventsCursor: string | null; mlEventsDone: boolean }> {
  const sessionsWithTag = await ctx.db
    .query("sessions")
    .withIndex("by_user_tag", (q) => q.eq("userId", params.userId).eq("tagId", params.tagId))
    .take(TAG_CLEANUP_BATCH_SIZE);
  for (const s of sessionsWithTag) {
    await ctx.db.patch(s._id, { tagId: undefined });
  }

  const cupsWithTag = await ctx.db
    .query("coffee_cups")
    .withIndex("by_user_tag", (q) => q.eq("userId", params.userId).eq("tagId", params.tagId))
    .take(TAG_CLEANUP_BATCH_SIZE);
  for (const c of cupsWithTag) {
    await ctx.db.patch(c._id, { tagId: undefined });
  }

  const attemptsWithTag = await ctx.db
    .query("session_attempts")
    .withIndex("by_user_tag", (q) => q.eq("userId", params.userId).eq("tagId", params.tagId))
    .take(TAG_CLEANUP_BATCH_SIZE);
  for (const a of attemptsWithTag) {
    await ctx.db.patch(a._id, { tagId: undefined });
  }

  const attemptsWithInitialTag = await ctx.db
    .query("session_attempts")
    .withIndex("by_user_initial_tag", (q) =>
      q.eq("userId", params.userId).eq("initialTagId", params.tagId)
    )
    .take(TAG_CLEANUP_BATCH_SIZE);
  for (const a of attemptsWithInitialTag) {
    await ctx.db.patch(a._id, { initialTagId: undefined });
  }

  let mlEventsDone = params.mlEventsDone;
  let nextMlEventsCursor: string | null = params.mlEventsCursor;

  if (!mlEventsDone) {
    const mlEventsPage = await ctx.db
      .query("ml_events")
      .withIndex("by_user_timestamp", (q) => q.eq("userId", params.userId))
      .order("desc")
      .paginate({ numItems: TAG_CLEANUP_BATCH_SIZE, cursor: params.mlEventsCursor });

    for (const evt of mlEventsPage.page) {
      const clearTag = evt.tagId === params.tagId;
      const clearFrom = evt.fromTagId === params.tagId;
      const clearTo = evt.toTagId === params.tagId;
      if (clearTag || clearFrom || clearTo) {
        await ctx.db.patch(evt._id, {
          ...(clearTag ? { tagId: undefined } : {}),
          ...(clearFrom ? { fromTagId: undefined } : {}),
          ...(clearTo ? { toTagId: undefined } : {}),
        });
      }
    }

    mlEventsDone = mlEventsPage.isDone;
    nextMlEventsCursor = mlEventsPage.isDone ? null : mlEventsPage.continueCursor;
  }

  const hasMore =
    sessionsWithTag.length === TAG_CLEANUP_BATCH_SIZE ||
    cupsWithTag.length === TAG_CLEANUP_BATCH_SIZE ||
    attemptsWithTag.length === TAG_CLEANUP_BATCH_SIZE ||
    attemptsWithInitialTag.length === TAG_CLEANUP_BATCH_SIZE ||
    !mlEventsDone;

  return { hasMore, nextMlEventsCursor, mlEventsDone };
}

export const create = mutation({
  args: {
    id: v.optional(v.string()),
    name: v.string(),
    color: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, true);
    if (args.id !== undefined) {
      assertValidTagId(args.id, "Invalid tag id format.", true);
    }
    const now = new Date().toISOString();
    const sanitizedName = validateTagName(args.name);
    const sanitizedColor = sanitizeTagColor(args.color);
    const currentTags = user.tags ?? DEFAULT_TAGS;

    const existingIndex = args.id ? currentTags.findIndex((t) => t.id === args.id) : -1;
    if (existingIndex === -1 && currentTags.length >= MAX_TAGS_PER_USER) {
      throw new Error(`Maximum limit of ${MAX_TAGS_PER_USER} custom tags reached.`);
    }

    const newTag = {
      id: args.id ?? `tag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: sanitizedName,
      color: sanitizedColor,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    };

    const filtered = currentTags.filter((t) => t.id !== newTag.id);
    await ctx.db.patch(user._id, {
      tags: [...filtered, newTag],
    });

    return newTag;
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    isArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    assertValidTagId(args.id, "Invalid tag id format.", true);
    const now = new Date().toISOString();
    const currentTags = user.tags ?? DEFAULT_TAGS;

    let found = false;
    let hasChanges = false;
    const updatedTags = currentTags.map((tag) => {
      if (tag.id === args.id) {
        found = true;
        const newName = args.name !== undefined ? validateTagName(args.name) : tag.name;
        const newColor = args.color !== undefined ? sanitizeTagColor(args.color) : tag.color;
        const newArchived = args.isArchived !== undefined ? args.isArchived : tag.isArchived;

        if (newName !== tag.name || newColor !== tag.color || newArchived !== tag.isArchived) {
          hasChanges = true;
          return {
            ...tag,
            name: newName,
            color: newColor,
            isArchived: newArchived,
            updatedAt: now,
          };
        }
      }
      return tag;
    });

    if (!found) {
      throw new Error(`Tag with ID "${args.id}" not found.`);
    }

    if (hasChanges) {
      await ctx.db.patch(user._id, {
        tags: updatedTags,
      });
    }

    return updatedTags.find((t) => t.id === args.id);
  },
});

export const remove = mutation({
  args: {
    id: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    assertValidTagId(args.id, "Invalid tag id format.", true);
    const currentTags = user.tags ?? DEFAULT_TAGS;
    const filtered = currentTags.filter((t) => t.id !== args.id);

    if (filtered.length !== currentTags.length) {
      await ctx.db.patch(user._id, {
        tags: filtered,
      });
    }

    const activeTimer = await ctx.db
      .query("active_timers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (activeTimer && activeTimer.tagId === args.id) {
      await ctx.db.patch(activeTimer._id, { tagId: undefined, updatedAtMs: Date.now() });
    }

    // Clear orphaned tagId references in bounded batches and schedule continuation if needed
    const batchResult = await clearRemovedTagBatch(ctx, {
      userId: user._id,
      tagId: args.id,
      mlEventsCursor: null,
      mlEventsDone: false,
    });

    if (batchResult.hasMore) {
      await ctx.scheduler.runAfter(0, internal.tags.cleanupRemovedTagBatch, {
        userId: user._id,
        tagId: args.id,
        mlEventsCursor: batchResult.nextMlEventsCursor,
        mlEventsDone: batchResult.mlEventsDone,
      });
    }

    return true;
  },
});

export const cleanupRemovedTagBatch = internalMutation({
  args: {
    userId: v.id("users"),
    tagId: v.string(),
    mlEventsCursor: v.union(v.string(), v.null()),
    mlEventsDone: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Re-check current user tags: if the tag was recreated/re-imported, abort cleanup immediately
    const user = await ctx.db.get(args.userId);
    if (!user || (user.tags ?? DEFAULT_TAGS).some((t) => t.id === args.tagId)) {
      return null;
    }

    const batchResult = await clearRemovedTagBatch(ctx, {
      userId: args.userId,
      tagId: args.tagId,
      mlEventsCursor: args.mlEventsCursor,
      mlEventsDone: args.mlEventsDone,
    });

    if (batchResult.hasMore) {
      await ctx.scheduler.runAfter(0, internal.tags.cleanupRemovedTagBatch, {
        userId: args.userId,
        tagId: args.tagId,
        mlEventsCursor: batchResult.nextMlEventsCursor,
        mlEventsDone: batchResult.mlEventsDone,
      });
    }

    return null;
  },
});

export const resetToDefaults = mutation({
  args: {},
  returns: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      color: v.string(),
      isArchived: v.boolean(),
      createdAt: v.string(),
      updatedAt: v.optional(v.string()),
    })
  ),
  handler: async (ctx) => {
    const user = await requireUser(ctx);

    await ctx.db.patch(user._id, {
      tags: DEFAULT_TAGS,
    });

    const userSessions = await ctx.db
      .query("sessions")
      .withIndex("by_user_completed", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(TAG_CLEANUP_BATCH_SIZE);
    for (const s of userSessions) {
      if (s.tagId && !DEFAULT_TAG_ID_SET.has(s.tagId)) {
        await ctx.db.patch(s._id, { tagId: undefined });
      }
    }

    const userCups = await ctx.db
      .query("coffee_cups")
      .withIndex("by_user_date", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(TAG_CLEANUP_BATCH_SIZE);
    for (const c of userCups) {
      if (c.tagId && !DEFAULT_TAG_ID_SET.has(c.tagId)) {
        await ctx.db.patch(c._id, { tagId: undefined });
      }
    }

    const activeTimer = await ctx.db
      .query("active_timers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (activeTimer && activeTimer.tagId && !DEFAULT_TAG_ID_SET.has(activeTimer.tagId)) {
      await ctx.db.patch(activeTimer._id, { tagId: undefined, updatedAtMs: Date.now() });
    }

    const attempts = await ctx.db
      .query("session_attempts")
      .withIndex("by_user_ended", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(TAG_CLEANUP_BATCH_SIZE);
    for (const a of attempts) {
      const clearTag = Boolean(a.tagId && !DEFAULT_TAG_ID_SET.has(a.tagId));
      const clearInitialTag = Boolean(a.initialTagId && !DEFAULT_TAG_ID_SET.has(a.initialTagId));
      if (clearTag || clearInitialTag) {
        await ctx.db.patch(a._id, {
          ...(clearTag ? { tagId: undefined } : {}),
          ...(clearInitialTag ? { initialTagId: undefined } : {}),
        });
      }
    }

    const userEvents = await ctx.db
      .query("ml_events")
      .withIndex("by_user_timestamp", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(TAG_CLEANUP_BATCH_SIZE);
    for (const evt of userEvents) {
      const clearTag = Boolean(evt.tagId && !DEFAULT_TAG_ID_SET.has(evt.tagId));
      const clearFrom = Boolean(evt.fromTagId && !DEFAULT_TAG_ID_SET.has(evt.fromTagId));
      const clearTo = Boolean(evt.toTagId && !DEFAULT_TAG_ID_SET.has(evt.toTagId));
      if (clearTag || clearFrom || clearTo) {
        await ctx.db.patch(evt._id, {
          ...(clearTag ? { tagId: undefined } : {}),
          ...(clearFrom ? { fromTagId: undefined } : {}),
          ...(clearTo ? { toTagId: undefined } : {}),
        });
      }
    }

    const hitBatchLimit =
      userSessions.length === TAG_CLEANUP_BATCH_SIZE ||
      userCups.length === TAG_CLEANUP_BATCH_SIZE ||
      attempts.length === TAG_CLEANUP_BATCH_SIZE ||
      userEvents.length === TAG_CLEANUP_BATCH_SIZE;

    if (hitBatchLimit) {
      const initialStage =
        userSessions.length === TAG_CLEANUP_BATCH_SIZE
          ? "sessions"
          : userCups.length === TAG_CLEANUP_BATCH_SIZE
            ? "coffee_cups"
            : attempts.length === TAG_CLEANUP_BATCH_SIZE
              ? "session_attempts"
              : "ml_events";

      await ctx.scheduler.runAfter(0, internal.tags.cleanupResetTagsBatch, {
        userId: user._id,
        stage: initialStage,
        cursor: null,
      });
    }

    return DEFAULT_TAGS;
  },
});

export const cleanupResetTagsBatch = internalMutation({
  args: {
    userId: v.id("users"),
    stage: resetCleanupStageValidator,
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;
    // Always evaluate against the user's live tag set so new custom tags created after resetToDefaults are never stripped
    const validTagIdSet = new Set((user.tags ?? DEFAULT_TAGS).map((t) => t.id));

    if (args.stage === "sessions") {
      const page = await ctx.db
        .query("sessions")
        .withIndex("by_user_completed", (q) => q.eq("userId", args.userId))
        .order("desc")
        .paginate({ numItems: RESET_CONTINUATION_PAGE_SIZE, cursor: args.cursor });

      for (const s of page.page) {
        if (s.tagId && !validTagIdSet.has(s.tagId)) {
          await ctx.db.patch(s._id, { tagId: undefined });
        }
      }

      if (!page.isDone) {
        await ctx.scheduler.runAfter(0, internal.tags.cleanupResetTagsBatch, {
          userId: args.userId,
          stage: "sessions",
          cursor: page.continueCursor,
        });
      } else {
        await ctx.scheduler.runAfter(0, internal.tags.cleanupResetTagsBatch, {
          userId: args.userId,
          stage: "coffee_cups",
          cursor: null,
        });
      }
      return null;
    }

    if (args.stage === "coffee_cups") {
      const page = await ctx.db
        .query("coffee_cups")
        .withIndex("by_user_date", (q) => q.eq("userId", args.userId))
        .order("desc")
        .paginate({ numItems: RESET_CONTINUATION_PAGE_SIZE, cursor: args.cursor });

      for (const c of page.page) {
        if (c.tagId && !validTagIdSet.has(c.tagId)) {
          await ctx.db.patch(c._id, { tagId: undefined });
        }
      }

      if (!page.isDone) {
        await ctx.scheduler.runAfter(0, internal.tags.cleanupResetTagsBatch, {
          userId: args.userId,
          stage: "coffee_cups",
          cursor: page.continueCursor,
        });
      } else {
        await ctx.scheduler.runAfter(0, internal.tags.cleanupResetTagsBatch, {
          userId: args.userId,
          stage: "session_attempts",
          cursor: null,
        });
      }
      return null;
    }

    if (args.stage === "session_attempts") {
      const page = await ctx.db
        .query("session_attempts")
        .withIndex("by_user_ended", (q) => q.eq("userId", args.userId))
        .order("desc")
        .paginate({ numItems: RESET_CONTINUATION_PAGE_SIZE, cursor: args.cursor });

      for (const a of page.page) {
        const clearTag = Boolean(a.tagId && !validTagIdSet.has(a.tagId));
        const clearInitialTag = Boolean(a.initialTagId && !validTagIdSet.has(a.initialTagId));
        if (clearTag || clearInitialTag) {
          await ctx.db.patch(a._id, {
            ...(clearTag ? { tagId: undefined } : {}),
            ...(clearInitialTag ? { initialTagId: undefined } : {}),
          });
        }
      }

      if (!page.isDone) {
        await ctx.scheduler.runAfter(0, internal.tags.cleanupResetTagsBatch, {
          userId: args.userId,
          stage: "session_attempts",
          cursor: page.continueCursor,
        });
      } else {
        await ctx.scheduler.runAfter(0, internal.tags.cleanupResetTagsBatch, {
          userId: args.userId,
          stage: "ml_events",
          cursor: null,
        });
      }
      return null;
    }

    const page = await ctx.db
      .query("ml_events")
      .withIndex("by_user_timestamp", (q) => q.eq("userId", args.userId))
      .order("desc")
      .paginate({ numItems: RESET_CONTINUATION_PAGE_SIZE, cursor: args.cursor });

    for (const evt of page.page) {
      const clearTag = Boolean(evt.tagId && !validTagIdSet.has(evt.tagId));
      const clearFrom = Boolean(evt.fromTagId && !validTagIdSet.has(evt.fromTagId));
      const clearTo = Boolean(evt.toTagId && !validTagIdSet.has(evt.toTagId));
      if (clearTag || clearFrom || clearTo) {
        await ctx.db.patch(evt._id, {
          ...(clearTag ? { tagId: undefined } : {}),
          ...(clearFrom ? { fromTagId: undefined } : {}),
          ...(clearTo ? { toTagId: undefined } : {}),
        });
      }
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.tags.cleanupResetTagsBatch, {
        userId: args.userId,
        stage: "ml_events",
        cursor: page.continueCursor,
      });
    }

    return null;
  },
});
