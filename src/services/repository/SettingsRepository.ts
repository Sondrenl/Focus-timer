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
    return { ...DEFAULT_SETTINGS, ...saved };
  }

  async save(settings: UserSettings): Promise<void> {
    this.storage.setItem(SETTINGS_STORAGE_KEY, settings);
  }
}
