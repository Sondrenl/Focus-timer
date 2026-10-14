import { UserProfile } from '../../types/user';

export interface IProfileRepository {
  get(): Promise<UserProfile>;
  save(profile: UserProfile): Promise<void>;
  resetToDefaults(): Promise<UserProfile>;
}
