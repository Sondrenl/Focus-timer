import { LocalStorageService } from '../services/storage/LocalStorageService';
import { TagRepository } from '../services/repository/TagRepository';
import { SessionRepository } from '../services/repository/SessionRepository';
import { SettingsRepository } from '../services/repository/SettingsRepository';
import { ProfileRepository } from '../services/repository/ProfileRepository';
import { CoffeeRepository } from '../services/repository/CoffeeRepository';
import { AuthService } from '../services/auth/AuthService';
import { soundService } from '../services/audio/SoundService';
import { notificationService } from '../services/notification/NotificationService';

export const storageService = new LocalStorageService();
export const tagRepository = new TagRepository(storageService);
export const sessionRepository = new SessionRepository(storageService);
export const settingsRepository = new SettingsRepository(storageService);
export const profileRepository = new ProfileRepository(storageService);
export const coffeeRepository = new CoffeeRepository(storageService);
export const authService = AuthService.getInstance();

export { soundService, notificationService };
