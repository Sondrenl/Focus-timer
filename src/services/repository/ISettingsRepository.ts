import { UserSettings } from '../../types/settings';

/**
 * Settings Repository interface
 */
export interface ISettingsRepository {
  /** Retrieves saved user preferences */
  get(): Promise<UserSettings>;

  /** Saves updated user preferences */
  save(settings: UserSettings): Promise<void>;

  /** Resets preferences back to default */
  resetToDefaults(): Promise<UserSettings>;
}
