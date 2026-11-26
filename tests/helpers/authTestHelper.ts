/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { registerCore, sessionIdentity } from "@convex-dev/auth/test";
import { registerGoogleOauth } from "@convex-dev/auth/components/google/test";
import schema from "../../convex/schema";
import { components, internal } from "../../convex/_generated/api";

export const convexModules = import.meta.glob("../../convex/**/*.*s");

export function createConvexTest() {
  if (!process.env.CONVEX_CLOUD_URL) {
    process.env.CONVEX_CLOUD_URL = "https://some-deployment.convex.cloud";
  }
  const t = convexTest(schema, convexModules);
  registerCore(t);
  registerGoogleOauth(t);
  return t;
}

export async function createAuthenticatedTestUser(
  t: ReturnType<typeof createConvexTest>,
  overrides: {
    email?: string;
    sub?: string;
    name?: string;
    avatarUrl?: string;
  } = {}
) {
  const email = overrides.email ?? "test@example.com";
  const sub = overrides.sub ?? "google-sub-test";
  const name = overrides.name ?? "Test User";

  const userId = await t.mutation(internal.users.getOrCreateUserForAuth, {
    email,
    sub,
    name,
    ...(overrides.avatarUrl ? { avatarUrl: overrides.avatarUrl } : {}),
  });

  const tokens = await t.mutation(components.auth.public._internal_dangerous_signIn, {
    userId,
    componentPath: "authGoogle",
    claims: {
      method: "google",
      profile: {
        id: sub,
        email,
        emailVerified: true,
        name,
      },
    },
    accessTokenTtlSeconds: 60,
    refreshInactivityTimeoutSeconds: 30 * 24 * 60 * 60,
    sessionMaxLifetimeSeconds: 30 * 24 * 60 * 60,
  });

  const asUser = t.withIdentity({
    ...sessionIdentity(tokens),
    email,
    name,
  });

  return { userId, asUser, tokens };
}
