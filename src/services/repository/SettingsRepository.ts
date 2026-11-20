import { UserSettings, DEFAULT_SETTINGS } from '../../types/settings';
import { IStorageService } from '../storage/IStorageService';

export interface ISettingsRepository {
  get(): Promise<UserSettings>;
  save(settings: UserSettings): Promise<void>;
  resetToDefaults(): Promise<UserSettings>;
}

const SETTINGS_STORAGE_KEY = 'settings_v1';

/**
 * Settings repository implementation using IStorageService
 */
export class SettingsRepository implements ISettingsRepository {
  private storage: IStorageService;

  constructor(storage: IStorageService) {
    this.storage = storage;
  }

  private sanitize(saved: Partial<UserSettings> | null): UserSettings {
    if (!saved || typeof saved !== 'object') {
      return { ...DEFAULT_SETTINGS };
    }
    const merged: UserSettings = { ...DEFAULT_SETTINGS, ...saved };

    // Guard against corrupt/non-positive duration or cycle numbers and clamp consistently
    if (
      typeof merged.workDurationMinutes !== 'number' ||
      !Number.isFinite(merged.workDurationMinutes) ||
      merged.workDurationMinutes <= 0
    ) {
      merged.workDurationMinutes = DEFAULT_SETTINGS.workDurationMinutes;
    } else {
      merged.workDurationMinutes = Math.max(
        0.01,
        Math.min(360, Math.round(merged.workDurationMinutes * 100) / 100)
      );
    }

    if (
      typeof merged.shortBreakDurationMinutes !== 'number' ||
      !Number.isFinite(merged.shortBreakDurationMinutes) ||
      merged.shortBreakDurationMinutes <= 0
    ) {
      merged.shortBreakDurationMinutes = DEFAULT_SETTINGS.shortBreakDurationMinutes;
    } else {
      merged.shortBreakDurationMinutes = Math.max(
        0.01,
        Math.min(120, Math.round(merged.shortBreakDurationMinutes * 100) / 100)
      );
    }

    if (
      typeof merged.longBreakDurationMinutes !== 'number' ||
      !Number.isFinite(merged.longBreakDurationMinutes) ||
      merged.longBreakDurationMinutes <= 0
    ) {
      merged.longBreakDurationMinutes = DEFAULT_SETTINGS.longBreakDurationMinutes;
    } else {
      merged.longBreakDurationMinutes = Math.max(
        0.01,
        Math.min(180, Math.round(merged.longBreakDurationMinutes * 100) / 100)
      );
    }

    if (
      typeof merged.longBreakInterval !== 'number' ||
      !Number.isFinite(merged.longBreakInterval) ||
      merged.longBreakInterval < 1
    ) {
      merged.longBreakInterval = DEFAULT_SETTINGS.longBreakInterval;
    } else {
      merged.longBreakInterval = Math.max(
        1,
        Math.min(20, Math.floor(merged.longBreakInterval))
      );
    }

    if (typeof merged.soundVolume !== 'number' || !Number.isFinite(merged.soundVolume)) {
      merged.soundVolume = DEFAULT_SETTINGS.soundVolume;
    } else {
      merged.soundVolume = Math.max(0, Math.min(1, merged.soundVolume));
    }

    return merged;
  }

  getSync(): UserSettings {
    const saved = this.storage.getItem<Partial<UserSettings> | null>(SETTINGS_STORAGE_KEY, null);
    return this.sanitize(saved);
  }

  async get(): Promise<UserSettings> {
    return this.getSync();
  }

  async save(settings: UserSettings): Promise<void> {
    this.storage.setItem(SETTINGS_STORAGE_KEY, this.sanitize(settings));
  }

  async resetToDefaults(): Promise<UserSettings> {
    this.storage.setItem(SETTINGS_STORAGE_KEY, DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  }
}
