import { IProfileRepository } from './IProfileRepository';
import { UserProfile, DEFAULT_PROFILE } from '../../types/user';
import { IStorageService } from '../storage/IStorageService';

const PROFILE_STORAGE_KEY = 'profile_v1';

export class ProfileRepository implements IProfileRepository {
  private storage: IStorageService;

  constructor(storage: IStorageService) {
    this.storage = storage;
  }

  async get(): Promise<UserProfile> {
    const saved = this.storage.getItem<Partial<UserProfile> | null>(PROFILE_STORAGE_KEY, null);
    if (!saved) {
      return { ...DEFAULT_PROFILE };
    }
    return { ...DEFAULT_PROFILE, ...saved };
  }

  async save(profile: UserProfile): Promise<void> {
    this.storage.setItem(PROFILE_STORAGE_KEY, profile);
  }

  async resetToDefaults(): Promise<UserProfile> {
    this.storage.setItem(PROFILE_STORAGE_KEY, DEFAULT_PROFILE);
    return { ...DEFAULT_PROFILE };
  }
}
