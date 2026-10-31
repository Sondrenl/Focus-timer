import { ConvexReactClient } from "convex/react";

export const DEFAULT_CONVEX_URL = "https://agile-seahorse-756.eu-west-1.convex.cloud";

export const convexUrl =
  import.meta.env.VITE_CONVEX_URL ||
  (typeof window !== "undefined" && (window as any).__CONVEX_URL__) ||
  DEFAULT_CONVEX_URL;

export const isConvexConfigured = Boolean(
  convexUrl && !convexUrl.includes("dummy") && !convexUrl.includes("proud-otter")
);

export const convexClient = new ConvexReactClient(convexUrl);
