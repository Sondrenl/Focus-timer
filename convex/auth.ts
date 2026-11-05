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
        const token = credentials.token as string | undefined;
        if (!token) {
          throw new Error("Missing Google ID token");
        }

        // Verify the Google token cryptographically with Google's public JWKS
        const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
          issuer: ["https://accounts.google.com", "accounts.google.com"],
          audience: GOOGLE_CLIENT_ID,
        });

        const email = payload.email as string | undefined;
        const sub = payload.sub as string | undefined;
        const name =
          (payload.name as string | undefined) ||
          email?.split("@")[0] ||
          "Focus Practitioner";
        const picture = payload.picture as string | undefined;

        if (!email || !sub) {
          throw new Error("Invalid token payload: missing email or sub");
        }
        if (payload.email_verified === false) {
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
