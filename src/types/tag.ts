/**
 * Tag model for categorizing Pomodoro focus sessions.
 * Follows soft-delete pattern via isArchived flag.
 */
export interface Tag {
  /** Unique UUID identifier */
  id: string;
  /** Human-readable tag label */
  name: string;
  /** Hex color code (pastel Material Design 3 palette) */
  color: string;
  /** Soft-delete flag: if true, hidden from selector and active stats */
  isArchived: boolean;
  /** ISO timestamp string of creation */
  createdAt: string;
  /** ISO timestamp string of last modification (archive/unarchive/edit) */
  updatedAt?: string;
}

export type CreateTagInput = Omit<Tag, 'id' | 'createdAt' | 'updatedAt' | 'isArchived'>;
export type UpdateTagInput = Partial<Omit<Tag, 'id' | 'createdAt'>>;
