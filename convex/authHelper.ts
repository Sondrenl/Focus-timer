import { QueryCtx, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { DEFAULT_SETTINGS, DEFAULT_TAGS } from "./defaultData";
export { DEFAULT_SETTINGS, DEFAULT_TAGS };

/**
 * Retrieves the currently authenticated user document from the @convex-dev/auth session.
 */
export async function getAuthenticatedUser(
  ctx: QueryCtx | MutationCtx,
  _autoCreate?: boolean
): Promise<Doc<"users"> | null> {
  let userId: Id<"users"> | null = null;
  try {
    userId = await getAuthUserId(ctx);
  } catch {
    return null;
  }
  if (!userId) return null;

  const normalizedId = ctx.db.normalizeId("users", userId);
  if (!normalizedId) return null;

  return (await ctx.db.get(normalizedId)) ?? null;
}

export async function requireUser(
  ctx: QueryCtx | MutationCtx,
  _autoCreate?: boolean
): Promise<Doc<"users">> {
  const user = await getAuthenticatedUser(ctx);
  if (!user) {
    throw new Error("Unauthorized: Please sign in to perform this action.");
  }
  return user;
}
