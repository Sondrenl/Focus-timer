import { ConvexReactClient } from "convex/react";
import { AUTH_TOKEN_KEY, parseGoogleJwt } from "../auth/AuthService";

export const PROD_CONVEX_URL = "https://acrobatic-oyster-97.convex.cloud";
export const DEV_CONVEX_URL = "https://agile-seahorse-756.eu-west-1.convex.cloud";

export const DEFAULT_CONVEX_URL = import.meta.env.PROD
  ? PROD_CONVEX_URL
  : DEV_CONVEX_URL;

// Ensure production builds always point to production deployment even if .env.local has dev URL
export const convexUrl =
  (typeof window !== "undefined" && (window as any).__CONVEX_URL__) ||
  (import.meta.env.PROD
    ? (import.meta.env.VITE_CONVEX_PROD_URL ||
       (import.meta.env.VITE_CONVEX_URL && !import.meta.env.VITE_CONVEX_URL.includes("agile-seahorse")
         ? import.meta.env.VITE_CONVEX_URL
         : PROD_CONVEX_URL))
    : (import.meta.env.VITE_CONVEX_URL || DEV_CONVEX_URL));

export const isConvexConfigured = Boolean(
  convexUrl && !convexUrl.includes("dummy") && !convexUrl.includes("proud-otter")
);

// Disable Convex's default unsavedChangesWarning to avoid "Reload site? Changes you made may not be saved" prompts
export const convexClient = new ConvexReactClient(convexUrl, {
  unsavedChangesWarning: false,
});

// Intercept beforeunload at the root level to suppress any unwanted reload dialogs
if (typeof window !== "undefined") {
  window.addEventListener(
    "beforeunload",
    (e) => {
      // Prevent browser "unsaved changes" prompts on refresh or tab navigation
      e.stopImmediatePropagation();
    },
    { capture: true }
  );
}

// Eagerly restore auth token from localStorage if valid, avoiding delayed sync on startup
if (isConvexConfigured && typeof window !== "undefined") {
  try {
    const storedToken =
      localStorage.getItem(AUTH_TOKEN_KEY) ||
      localStorage.getItem("auth_token_v1");
    if (storedToken) {
      const payload = parseGoogleJwt(storedToken);
      if (payload && (!payload.exp || payload.exp * 1000 > Date.now())) {
        convexClient.setAuth(async () => storedToken);
      }
    }
  } catch {
    // Ignore storage errors
  }
}
