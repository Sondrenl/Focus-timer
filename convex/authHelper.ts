import { QueryCtx, MutationCtx } from "./_generated/server";
import { Doc } from "./_generated/dataModel";

import { DEFAULT_SETTINGS, DEFAULT_TAGS } from "./defaultData";
export { DEFAULT_SETTINGS, DEFAULT_TAGS };

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

  // Fallback: match by email (for users migrated from Cloudflare D1 or pre-seeded)
  if (identity.email) {
    const existingByEmail = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();

    if (existingByEmail) {
      if ("patch" in ctx.db) {
        await (ctx.db as MutationCtx["db"]).patch(existingByEmail._id, {
          tokenIdentifier: identity.tokenIdentifier,
          avatarUrl: identity.pictureUrl || existingByEmail.avatarUrl,
        });
      }
      return existingByEmail;
    }
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
      tags: DEFAULT_TAGS,
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
