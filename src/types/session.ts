import { SessionType } from './timer';

/**
 * Historical record of a completed focus or break session
 */
export interface CompletedSession {
  /** Unique session ID */
  id: string;
  /** Reference to Tag ID (can point to archived tags) */
  tagId: string | null;
  /** Type of completed session (WORK, SHORT_BREAK, LONG_BREAK) */
  sessionType: SessionType;
  /** Actual duration elapsed in seconds */
  durationSeconds: number;
  /** ISO timestamp string when session completed */
  completedAt: string;
}
