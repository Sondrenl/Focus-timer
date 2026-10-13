import { CompletedSession } from '../../types/session';

/**
 * Session Repository Interface for completed Pomodoro intervals
 */
export interface ISessionRepository {
  /** Retrieves all historical sessions recorded */
  getAll(): Promise<CompletedSession[]>;

  /** Appends a newly completed focus or break session */
  add(session: Omit<CompletedSession, 'id'>): Promise<CompletedSession>;

  /** Clears all historical records */
  clear(): Promise<void>;
}
