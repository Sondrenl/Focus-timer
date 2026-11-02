/**
 * Single source of truth for initial defaults shared between Convex and Frontend
 */
export const DEFAULT_SETTINGS = {
  workDurationMinutes: 25,
  shortBreakDurationMinutes: 5,
  longBreakDurationMinutes: 25,
  longBreakInterval: 4,
  autoStartBreaks: false,
  autoStartPomodoros: false,
  soundVolume: 0.8,
  soundEnabled: true,
  notificationsEnabled: false,
  keepAwake: false,
};

export const DEFAULT_TAGS = [
  { id: "tag-deep-work", name: "Deep Work", color: "#7E57C2", isArchived: false, createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z" },
  { id: "tag-study", name: "Study & Learning", color: "#5C6BC0", isArchived: false, createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z" },
  { id: "tag-coding", name: "Coding & Dev", color: "#00897B", isArchived: false, createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z" },
  { id: "tag-writing", name: "Writing", color: "#D81B60", isArchived: false, createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z" },
  { id: "tag-admin", name: "Admin & Emails", color: "#FB8C00", isArchived: false, createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z" },
];
