import { ConvexReactClient } from "convex/react";

export const DEFAULT_CONVEX_URL = import.meta.env.PROD
  ? "https://acrobatic-oyster-97.convex.cloud"
  : "https://agile-seahorse-756.eu-west-1.convex.cloud";

export const convexUrl =
  import.meta.env.VITE_CONVEX_URL ||
  (typeof window !== "undefined" && (window as any).__CONVEX_URL__) ||
  DEFAULT_CONVEX_URL;

export const isConvexConfigured = Boolean(
  convexUrl && !convexUrl.includes("dummy") && !convexUrl.includes("proud-otter")
);

export const convexClient = new ConvexReactClient(convexUrl);

// Eagerly restore auth token from localStorage if valid, avoiding delayed sync on startup
if (isConvexConfigured && typeof window !== "undefined") {
  try {
    const storedToken = localStorage.getItem("auth_token_v1");
    if (storedToken) {
      convexClient.setAuth(async () => storedToken);
    }
  } catch {
    // Ignore storage errors
  }
}
