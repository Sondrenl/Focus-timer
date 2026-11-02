import { QueryCtx, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { DEFAULT_SETTINGS, DEFAULT_TAGS } from "./defaultData";
export { DEFAULT_SETTINGS, DEFAULT_TAGS };

/**
 * Retrieves the currently authenticated user document.
 * Checks both persistent Convex Auth sessions and legacy JWT tokens.
 * In a mutation context, if the user document does not exist yet, optionally creates it.
 */
export async function getAuthenticatedUser(
  ctx: QueryCtx | MutationCtx,
  autoCreate: boolean = false
): Promise<Doc<"users"> | null> {
  // 1. Check Convex Auth identity (minted from 30-day session)
  try {
    const authUserId = await getAuthUserId(ctx);
    if (authUserId) {
      const user = await ctx.db.get(authUserId as Id<"users">);
      if (user) {
        return user;
      }
    }
  } catch {
    // Continue to fallback
  }

  // 2. Fallback to direct JWT identity (direct Google ID token)
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
      .withIndex("email", (q) => q.eq("email", identity.email))
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
