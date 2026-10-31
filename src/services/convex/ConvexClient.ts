import { ConvexReactClient } from "convex/react";

const convexUrl =
  import.meta.env.VITE_CONVEX_URL ||
  (typeof window !== "undefined" && (window as any).__CONVEX_URL__) ||
  "https://proud-otter-999.convex.cloud";

export const isConvexConfigured = Boolean(
  import.meta.env.VITE_CONVEX_URL &&
    !import.meta.env.VITE_CONVEX_URL.includes("dummy")
);

export const convexClient = new ConvexReactClient(convexUrl);
