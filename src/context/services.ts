import { LocalStorageService } from '../services/storage/LocalStorageService';
import {
  TagRepository,
  SessionRepository,
  SettingsRepository,
  ProfileRepository,
  CoffeeRepository,
  TelemetryRepository,
} from '../services/storage/guestRepositories';
import { TelemetryTracker } from '../services/telemetry/TelemetryTracker';
import { soundService } from '../services/audio/SoundService';
import { notificationService } from '../services/notification/NotificationService';

export const storageService = new LocalStorageService();
export const tagRepository = new TagRepository(storageService);
export const sessionRepository = new SessionRepository(storageService);
export const settingsRepository = new SettingsRepository(storageService);
export const profileRepository = new ProfileRepository(storageService);
export const coffeeRepository = new CoffeeRepository(storageService);
export const telemetryRepository = new TelemetryRepository(storageService);
export const telemetryTracker = new TelemetryTracker(telemetryRepository);

export { soundService, notificationService };
