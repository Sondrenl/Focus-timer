import { setupConvexAuth } from "@convex-dev/auth/server";
import { setupGoogle } from "@convex-dev/auth/methods/google/server";
import { components, internal } from "./_generated/api";

const DEFAULT_ALLOWED_REDIRECT_ORIGINS = [
  "https://focus-timer.sondrelassen.workers.dev",
  "https://dev-focus-timer.sondrelassen.workers.dev",
  "http://localhost:5173",
];

const extraAllowedOrigins = (process.env.ALLOWED_REDIRECT_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const allowedRedirectOrigins = Array.from(
  new Set([...DEFAULT_ALLOWED_REDIRECT_ORIGINS, ...extraAllowedOrigins])
);

const auth = setupConvexAuth({
  component: components.auth,
  sessionMaxLifetimeSeconds: 30 * 24 * 60 * 60, // 30 days
  refreshInactivityTimeoutSeconds: 30 * 24 * 60 * 60, // 30 days
});

export const { signOut, refreshSession, isAuthenticated } = auth;

export const { startSignInWithGoogle, completeSignInWithGoogle } = setupGoogle(
  auth,
  {
    component: components.authGoogle,
    allowedRedirectOrigins,
  }
).attachUserCallbacks({
  createUser: internal.users.createUserFromGoogle,
  onSignIn: internal.users.onSignInGoogle,
});
