import { UserProfile, DEFAULT_PROFILE } from '../../types/user';
import { IStorageService } from '../storage/IStorageService';

export interface IProfileRepository {
  get(): Promise<UserProfile>;
  save(profile: UserProfile): Promise<void>;
  resetToDefaults(): Promise<UserProfile>;
}

const PROFILE_STORAGE_KEY = 'profile_v1';

export const MAX_DISPLAY_NAME_LENGTH = 50;

export function sanitizeProfile(raw: Partial<UserProfile> | null | undefined): UserProfile {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_PROFILE };
  }

  const displayName = typeof raw.displayName === 'string' && raw.displayName.trim()
    ? raw.displayName.trim().slice(0, MAX_DISPLAY_NAME_LENGTH)
    : DEFAULT_PROFILE.displayName;

  let avatarUrl: string | undefined = undefined;
  if (typeof raw.avatarUrl === 'string' && raw.avatarUrl.trim().startsWith('https://')) {
    avatarUrl = raw.avatarUrl.trim();
  }

  const rawDaily = Number(raw.dailyGoalMinutes);
  const dailyGoalMinutes = !isNaN(rawDaily) && rawDaily > 0
    ? Math.max(1, Math.min(1440, Math.floor(rawDaily)))
    : DEFAULT_PROFILE.dailyGoalMinutes;

  const avatarEmoji = typeof raw.avatarEmoji === 'string'
    ? raw.avatarEmoji.trim().slice(0, 10)
    : DEFAULT_PROFILE.avatarEmoji;

  const createdAt = typeof raw.createdAt === 'string' && !isNaN(new Date(raw.createdAt).getTime())
    ? raw.createdAt
    : DEFAULT_PROFILE.createdAt;

  return {
    displayName,
    avatarUrl,
    dailyGoalMinutes,
    avatarEmoji,
    createdAt,
    id: typeof raw.id === 'string' ? raw.id : undefined,
    email: typeof raw.email === 'string' ? raw.email : undefined,
  };
}

export class ProfileRepository implements IProfileRepository {
  private storage: IStorageService;

  constructor(storage: IStorageService) {
    this.storage = storage;
  }

  async get(): Promise<UserProfile> {
    const saved = this.storage.getItem<Partial<UserProfile> | null>(PROFILE_STORAGE_KEY, null);
    return sanitizeProfile(saved);
  }

  async save(profile: UserProfile): Promise<void> {
    const safe = sanitizeProfile(profile);
    this.storage.setItem(PROFILE_STORAGE_KEY, safe);
  }

  async resetToDefaults(): Promise<UserProfile> {
    this.storage.setItem(PROFILE_STORAGE_KEY, DEFAULT_PROFILE);
    return { ...DEFAULT_PROFILE };
  }
}
