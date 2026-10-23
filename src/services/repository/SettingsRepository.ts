import { ISettingsRepository } from './ISettingsRepository';
import { UserSettings, DEFAULT_SETTINGS } from '../../types/settings';
import { IStorageService } from '../storage/IStorageService';

const SETTINGS_STORAGE_KEY = 'settings_v1';

/**
 * Settings repository implementation using IStorageService
 */
export class SettingsRepository implements ISettingsRepository {
  private storage: IStorageService;

  constructor(storage: IStorageService) {
    this.storage = storage;
  }

  async get(): Promise<UserSettings> {
    const saved = this.storage.getItem<Partial<UserSettings> | null>(SETTINGS_STORAGE_KEY, null);
    if (!saved) {
      return { ...DEFAULT_SETTINGS };
    }
    const merged: UserSettings = { ...DEFAULT_SETTINGS, ...saved };

    // Guard against corrupt/non-positive duration or cycle numbers
    if (
      typeof merged.workDurationMinutes !== 'number' ||
      merged.workDurationMinutes <= 0 ||
      Number.isNaN(merged.workDurationMinutes)
    ) {
      merged.workDurationMinutes = DEFAULT_SETTINGS.workDurationMinutes;
    }
    if (
      typeof merged.shortBreakDurationMinutes !== 'number' ||
      merged.shortBreakDurationMinutes <= 0 ||
      Number.isNaN(merged.shortBreakDurationMinutes)
    ) {
      merged.shortBreakDurationMinutes = DEFAULT_SETTINGS.shortBreakDurationMinutes;
    }
    if (
      typeof merged.longBreakDurationMinutes !== 'number' ||
      merged.longBreakDurationMinutes <= 0 ||
      Number.isNaN(merged.longBreakDurationMinutes)
    ) {
      merged.longBreakDurationMinutes = DEFAULT_SETTINGS.longBreakDurationMinutes;
    }
    if (
      typeof merged.longBreakInterval !== 'number' ||
      merged.longBreakInterval < 1 ||
      Number.isNaN(merged.longBreakInterval)
    ) {
      merged.longBreakInterval = DEFAULT_SETTINGS.longBreakInterval;
    }
    if (typeof merged.soundVolume !== 'number' || Number.isNaN(merged.soundVolume)) {
      merged.soundVolume = DEFAULT_SETTINGS.soundVolume;
    } else {
      merged.soundVolume = Math.max(0, Math.min(1, merged.soundVolume));
    }

    return merged;
  }

  async save(settings: UserSettings): Promise<void> {
    this.storage.setItem(SETTINGS_STORAGE_KEY, settings);
  }

  async resetToDefaults(): Promise<UserSettings> {
    this.storage.setItem(SETTINGS_STORAGE_KEY, DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  }
}
