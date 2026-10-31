import { QueryCtx, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";

export const DEFAULT_SETTINGS = {
  workDurationMinutes: 25,
  shortBreakDurationMinutes: 5,
  longBreakDurationMinutes: 25,
  longBreakInterval: 4,
  autoStartBreaks: false,
  autoStartPomodoros: false,
  soundVolume: 0.8,
  soundEnabled: true,
  notificationsEnabled: false,
  keepAwake: false,
};

/**
 * Retrieves the currently authenticated user document.
 * In a mutation context, if the user document does not exist yet, creates it.
 */
export async function getAuthenticatedUser(
  ctx: QueryCtx | MutationCtx,
  autoCreate: boolean = false
): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }

  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();

  if (user) {
    return user;
  }

  if (autoCreate && "insert" in ctx.db) {
    const mutationDb = ctx.db as MutationCtx["db"];
    const now = new Date().toISOString();
    const userId = await mutationDb.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      email: identity.email ?? "",
      displayName: identity.name ?? identity.email?.split("@")[0] ?? "Focus Practitioner",
      avatarUrl: identity.pictureUrl,
      avatarEmoji: "",
      dailyGoalMinutes: 120,
      createdAt: now,
      settings: {
        ...DEFAULT_SETTINGS,
        updatedAt: now,
      },
    });

    return await mutationDb.get(userId);
  }

  return null;
}

export async function requireUser(
  ctx: QueryCtx | MutationCtx,
  autoCreate: boolean = false
): Promise<Doc<"users">> {
  const user = await getAuthenticatedUser(ctx, autoCreate);
  if (!user) {
    throw new Error("Unauthorized: Please sign in to perform this action.");
  }
  return user;
}
