import { CompletedSession } from '../types/session';

/**
 * Generates realistic focus sessions for preview and development environments.
 * Dates are calculated dynamically relative to the current date so that
 * today, yesterday, and the current week/month always have rich analytics.
 */
export function generateSampleSessions(): CompletedSession[] {
  const sessions: CompletedSession[] = [];
  const tags = [
    'tag-deep-work',
    'tag-coding',
    'tag-study',
    'tag-writing',
    'tag-admin',
  ];

  const now = new Date();

  // Helper to add sessions on a specific day offset (0 = today, 1 = yesterday, etc.)
  const addDaySessions = (daysAgo: number, tagIndices: number[], startHour = 9) => {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);

    tagIndices.forEach((tagIndex, i) => {
      const sessionDate = new Date(d);
      sessionDate.setHours(startHour + i * 2, Math.floor(Math.random() * 25), 0, 0);

      sessions.push({
        id: `sample-session-${daysAgo}-${i}`,
        tagId: tags[tagIndex % tags.length],
        sessionType: 'WORK',
        durationSeconds: 1500, // 25 minutes
        completedAt: sessionDate.toISOString(),
      });
    });
  };

  // Today: 3 sessions (75m total focus time to show progress on daily target)
  addDaySessions(0, [0, 1, 2], 10);

  // Yesterday: 4 sessions (100m total)
  addDaySessions(1, [1, 1, 0, 3], 9);

  // 2 days ago: 5 sessions (125m total)
  addDaySessions(2, [0, 0, 1, 2, 4], 9);

  // 3 days ago: 3 sessions (75m total)
  addDaySessions(3, [2, 3, 0], 11);

  // 4 days ago: 4 sessions (100m total)
  addDaySessions(4, [1, 2, 1, 0], 9);

  // 5 days ago: 2 sessions (50m total)
  addDaySessions(5, [3, 4], 14);

  // 6 days ago: 4 sessions (100m total)
  addDaySessions(6, [0, 1, 0, 2], 10);

  // Days 7 through 28: Realistic weekday work sessions across the past month
  for (let day = 7; day <= 28; day++) {
    const d = new Date(now);
    d.setDate(d.getDate() - day);
    const dayOfWeek = d.getDay();

    // Skip most weekend days, occasionally add 1 session
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      if (day % 3 === 0) {
        addDaySessions(day, [day % tags.length], 11);
      }
      continue;
    }

    const numSessions = (day % 3) + 2; // 2 to 4 sessions
    const tagChoices = Array.from({ length: numSessions }, (_, idx) => (day + idx) % tags.length);
    addDaySessions(day, tagChoices, 9);
  }

  return sessions;
}
