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
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }

  // 1. Check Convex Auth identity (minted from 30-day session).
  // Convex Auth tokens use issuer === CONVEX_SITE_URL and subject === "<userId>|<sessionId>".
  // Never fall through to direct JWT fallback for Convex Auth identities (e.g. if the user
  // document was deleted, return null instead of spawning a phantom row).
  const convexSiteUrl = process.env.CONVEX_SITE_URL?.trim();
  const isConvexAuthIdentity =
    Boolean(convexSiteUrl && identity.issuer === convexSiteUrl) ||
    (typeof identity.subject === "string" && identity.subject.includes("|"));

  if (isConvexAuthIdentity) {
    let convexAuthUserId: Id<"users"> | null = null;
    try {
      convexAuthUserId = await getAuthUserId(ctx);
    } catch {
      convexAuthUserId = null;
    }
    if (!convexAuthUserId) {
      return null;
    }
    const normalizedId = ctx.db.normalizeId("users", convexAuthUserId);
    if (!normalizedId) {
      return null;
    }
    return (await ctx.db.get(normalizedId)) ?? null;
  }

  // 2. Fallback to direct JWT identity (non-Convex-Auth).
  // Exact tokenIdentifier lookup is safe for any provider verified by auth.config.ts (or convex-test).
  let user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .first();

  const isGoogleIssuer =
    identity.issuer === "https://accounts.google.com" ||
    identity.issuer === "accounts.google.com";

  // Bare subject lookup is ONLY permitted for verified Google issuers (legacy migration rows)
  if (!user && isGoogleIssuer && identity.subject && identity.subject !== identity.tokenIdentifier) {
    user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.subject))
      .first();
  }

  if (user) {
    return user;
  }

  if (!isGoogleIssuer) {
    return null;
  }

  // Fallback: match by email (only if explicitly verified) for users migrated from Cloudflare D1 or pre-seeded
  if (identity.email && identity.emailVerified === true) {
    const existingByEmail = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", identity.email))
      .first();

    if (existingByEmail) {
      const nextAvatar = identity.pictureUrl || existingByEmail.avatarUrl;
      if (
        "patch" in ctx.db &&
        (existingByEmail.tokenIdentifier !== identity.tokenIdentifier ||
          existingByEmail.avatarUrl !== nextAvatar)
      ) {
        await (ctx.db as MutationCtx["db"]).patch(existingByEmail._id, {
          tokenIdentifier: identity.tokenIdentifier,
          avatarUrl: nextAvatar,
        });
        return {
          ...existingByEmail,
          tokenIdentifier: identity.tokenIdentifier,
          avatarUrl: nextAvatar,
        };
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
