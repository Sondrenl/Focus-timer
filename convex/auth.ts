import { convexAuth } from "@convex-dev/auth/server";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { internal } from "./_generated/api";

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs")
);

const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ||
  "229654613287-8utvd3fhrcsalh1ol02ev2mlg140kbai.apps.googleusercontent.com";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    ConvexCredentials({
      id: "google-id-token",
      authorize: async (credentials, ctx) => {
        const rawToken = credentials.token;
        if (typeof rawToken !== "string" || !rawToken.trim()) {
          throw new Error("Missing Google ID token");
        }
        const token = rawToken.trim();

        // Verify the Google token cryptographically with Google's public JWKS
        const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
          issuer: ["https://accounts.google.com", "accounts.google.com"],
          audience: GOOGLE_CLIENT_ID,
        });

        const email =
          typeof payload.email === "string" ? payload.email.trim().toLowerCase() : undefined;
        const sub = typeof payload.sub === "string" ? payload.sub.trim() : undefined;
        const rawName = typeof payload.name === "string" ? payload.name.trim() : "";
        const name = (rawName || email?.split("@")[0] || "Focus Practitioner").slice(0, 100);
        const picture =
          typeof payload.picture === "string" &&
          payload.picture.startsWith("https://") &&
          payload.picture.length <= 2048
            ? payload.picture
            : undefined;

        if (!email || !sub) {
          throw new Error("Invalid token payload: missing email or sub");
        }
        if (payload.email_verified !== true) {
          throw new Error("Invalid token payload: email is not verified");
        }

        // Internal mutation links to existing user by email or creates a new user
        const userId = await ctx.runMutation(internal.users.getOrCreateUserForAuth, {
          email,
          sub,
          name,
          avatarUrl: picture,
        });

        return { userId };
      },
    }),
  ],
  session: {
    totalDurationMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    inactiveDurationMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
});
