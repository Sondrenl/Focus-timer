import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Run background maintenance sweep every 6 hours
crons.interval(
  "cleanup-stale-timers",
  { hours: 6 },
  internal.timer.cleanupStaleTimers
);

export default crons;
