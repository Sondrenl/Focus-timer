import { ConvexReactClient } from "convex/react";
import { isProduction } from "../../utils/environment";

export const PROD_CONVEX_URL = "https://acrobatic-oyster-97.convex.cloud";
export const DEV_CONVEX_URL = "https://agile-seahorse-756.eu-west-1.convex.cloud";

// Route production hostnames to prod Convex and local/preview/dev hostnames to dev Convex
const useProdConvex = import.meta.env.PROD && isProduction();
export const convexUrl =
  (typeof window !== "undefined" && (window as any).__CONVEX_URL__) ||
  (useProdConvex
    ? (import.meta.env.VITE_CONVEX_PROD_URL ||
       (import.meta.env.VITE_CONVEX_URL && !import.meta.env.VITE_CONVEX_URL.includes("agile-seahorse")
         ? import.meta.env.VITE_CONVEX_URL
         : PROD_CONVEX_URL))
    : (import.meta.env.VITE_CONVEX_DEV_URL ||
       (import.meta.env.VITE_CONVEX_URL && !import.meta.env.VITE_CONVEX_URL.includes("acrobatic-oyster")
         ? import.meta.env.VITE_CONVEX_URL
         : DEV_CONVEX_URL)));

export const isConvexConfigured = Boolean(
  convexUrl && !convexUrl.includes("dummy") && !convexUrl.includes("proud-otter")
);

export const convexSiteUrl = convexUrl
  ? convexUrl.replace(/\.convex\.cloud\/?$/, ".convex.site")
  : "";

// Disable Convex's default unsavedChangesWarning to avoid "Reload site? Changes you made may not be saved" prompts
export const convexClient = new ConvexReactClient(convexUrl, {
  unsavedChangesWarning: false,
});
