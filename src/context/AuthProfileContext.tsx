import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import { useConvexAuth, useAuthActions } from '@convex-dev/auth/react';
import { UserSettings } from '../types/settings';
import { UserProfile, DEFAULT_PROFILE, AuthState } from '../types/user';
import {
  AUTH_USER_KEY,
  parseGoogleJwt,
  buildProfileFromJwt,
  GOOGLE_CLIENT_ID,
} from '../services/auth/AuthService';
import { convexClient, convexUrl } from '../services/convex/ConvexClient';
import { SoundService } from '../services/audio/SoundService';
import {
  NotificationService,
  PushSubscriptionStatus,
} from '../services/notification/NotificationService';
import { useConvexSync } from '../services/convex/useConvexSync';
import { usePushSubscriptionSync } from '../hooks/usePushSubscriptionSync';
import { DEVICE_ID, TIMER_STORAGE_KEY } from './timer/timerPersistence';
import { sanitizeProfile } from '../services/storage/guestRepositories';
import { LAST_DAY_RESET_STORAGE_KEY } from '../utils/newDayCheck';
import {
  clearGuestDataModifiedFlag,
  getLocalDataOwnerUserId,
  markGuestDataModified,
  setLocalDataOwner,
} from '../services/sync/offlineOutbox';
import {
  authService,
  coffeeRepository,
  profileRepository,
  sessionRepository,
  settingsRepository,
  soundService,
  notificationService,
  tagRepository,
  telemetryTracker,
} from './services';

const LOGOUT_REMOTE_TIMEOUT_MS = 2500;
const MAX_GIS_INIT_ATTEMPTS = 20;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Operation timed out')), timeoutMs);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export function pickConvexSettings(s: Partial<UserSettings>) {
  return {
    workDurationMinutes: s.workDurationMinutes,
    shortBreakDurationMinutes: s.shortBreakDurationMinutes,
    longBreakDurationMinutes: s.longBreakDurationMinutes,
    longBreakInterval: s.longBreakInterval,
    autoStartBreaks: s.autoStartBreaks,
    autoStartPomodoros: s.autoStartPomodoros,
    soundVolume: s.soundVolume,
    soundEnabled: s.soundEnabled,
    keepAwake: s.keepAwake,
  };
}

function pickLocalSettings(s: Partial<UserSettings>): Partial<UserSettings> {
  return {
    ...pickConvexSettings(s),
    notificationsEnabled: s.notificationsEnabled,
  };
}

export async function clearAccountLocalCaches(): Promise<{
  cleanProfile: UserProfile;
  cleanSettings: UserSettings;
}> {
  await Promise.all([
    sessionRepository.clear(),
    coffeeRepository.clear(),
    tagRepository.resetToDefaults(),
    telemetryTracker.clearAll(),
  ]);
  const [cleanSettings, cleanProfile] = await Promise.all([
    settingsRepository.resetToDefaults(),
    profileRepository.resetToDefaults(),
  ]);
  clearGuestDataModifiedFlag();
  setLocalDataOwner('guest');

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem('active_tag_id_v1');
      window.localStorage.removeItem(TIMER_STORAGE_KEY);
      window.localStorage.removeItem(LAST_DAY_RESET_STORAGE_KEY);
    } catch {
      // Ignore storage access errors
    }
  }

  return { cleanProfile, cleanSettings };
}

export interface AuthProfileContextValue {
  auth: AuthState;
  isEffectiveAuthenticated: boolean;
  isConvexAuthReady: boolean;
  isConvexAuthAuthenticated: boolean;
  isConvexAuthLoading: boolean;
  isLoggingOut: boolean;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
  syncWithCloud: () => Promise<void>;
  profile: UserProfile;
  updateProfile: (newProfile: Partial<UserProfile>) => Promise<void>;
  resetProfileToDefaults: () => Promise<UserProfile>;
  settings: UserSettings;
  updateSettings: (newSettings: Partial<UserSettings>) => Promise<void>;
  resetSettingsToDefaults: () => Promise<UserSettings>;
  sound: SoundService;
  notifications: NotificationService;
  convexSync: ReturnType<typeof useConvexSync>;
  pushStatus: PushSubscriptionStatus;
  syncPushSubscription: () => Promise<{ ok: boolean; status: PushSubscriptionStatus; reason?: string }>;
}

const AuthProfileContext = createContext<AuthProfileContextValue | null>(null);

export const AuthProfileProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [localProfile, setLocalProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [localSettings, setLocalSettings] = useState<UserSettings>(() =>
    settingsRepository.getSync()
  );
  const [auth, setAuth] = useState<AuthState>(() =>
    authService.getInitialAuthState(convexUrl)
  );
  const [isLoggingOut, setIsLoggingOut] = useState<boolean>(false);

  const authEpochRef = useRef<number>(0);
  const isLoggingOutRef = useRef<boolean>(false);
  const wasConvexAuthenticatedRef = useRef<boolean>(false);

  const {
    isAuthenticated: isConvexAuthAuthenticated,
    isLoading: isConvexAuthLoading,
  } = useConvexAuth();
  const { signIn: convexSignIn, signOut: convexSignOut } = useAuthActions();

  const isConvexAuthReady =
    !isLoggingOut && isConvexAuthAuthenticated && !isConvexAuthLoading;

  const isEffectiveAuthenticated =
    !isLoggingOut &&
    (isConvexAuthLoading ? auth.isAuthenticated : isConvexAuthAuthenticated);

  const convexSync = useConvexSync(isEffectiveAuthenticated, isConvexAuthReady);
  const {
    isConvexConfigured,
    isConvexConnected,
    convexUser,
    vapidPublicKey,
    devicePushStatus,
    mutations: convexMutations,
  } = convexSync;

  const isConvexConnectedRef = useRef(isConvexConnected);
  isConvexConnectedRef.current = isConvexConnected;

  const shouldUseCloudState =
    isConvexConfigured &&
    isConvexAuthReady &&
    Boolean(convexUser) &&
    !isLoggingOut;

  const settings = useMemo<UserSettings>(() => {
    if (shouldUseCloudState && convexUser?.settings) {
      return {
        ...convexUser.settings,
        notificationsEnabled: localSettings.notificationsEnabled,
      };
    }
    return localSettings;
  }, [shouldUseCloudState, convexUser?.settings, localSettings]);

  const profile = useMemo<UserProfile>(() => {
    if (shouldUseCloudState && convexUser) {
      return sanitizeProfile({
        id: convexUser.id,
        email: convexUser.email,
        displayName: convexUser.displayName,
        avatarUrl: convexUser.avatarUrl,
        avatarEmoji: convexUser.avatarEmoji,
        dailyGoalMinutes: convexUser.dailyGoalMinutes,
      });
    }
    return localProfile;
  }, [shouldUseCloudState, convexUser, localProfile]);

  const settingsRef = useRef<UserSettings>(settings);
  settingsRef.current = settings;

  const profileRef = useRef<UserProfile>(profile);
  profileRef.current = profile;

  useEffect(() => {
    if (!shouldUseCloudState || !convexUser) return;
    authService.saveAuthUser(profile);
    setAuth((prev) => {
      if (
        prev.isAuthenticated &&
        !prev.isTokenExpired &&
        prev.user?.id === profile.id &&
        prev.user?.email === profile.email &&
        prev.user?.displayName === profile.displayName
      ) {
        return prev;
      }
      return {
        ...prev,
        isAuthenticated: true,
        isTokenExpired: false,
        user: profile,
      };
    });
  }, [shouldUseCloudState, convexUser, profile]);

  const resetLocalAuthUi = useCallback(
    async (options: { isTokenExpired?: boolean; wipeCaches?: boolean } = {}) => {
      setAuth({
        isAuthenticated: false,
        user: null,
        token: null,
        isSyncing: false,
        lastSyncedAt: null,
        syncError: null,
        isTokenExpired: Boolean(options.isTokenExpired),
      });

      if (options.wipeCaches) {
        const { cleanProfile, cleanSettings } = await clearAccountLocalCaches();
        setLocalProfile(cleanProfile);
        setLocalSettings(cleanSettings);
      } else {
        const cleanProfile = await profileRepository.resetToDefaults();
        setLocalProfile(cleanProfile);
      }
    },
    []
  );

  const logout = useCallback(async (): Promise<void> => {
    if (isLoggingOutRef.current) return;
    isLoggingOutRef.current = true;
    setIsLoggingOut(true);
    authEpochRef.current += 1;

    try {
      const canCallRemote =
        isConvexConfigured &&
        isConvexAuthReady &&
        isConvexConnectedRef.current &&
        !auth.isTokenExpired;

      await notificationService.unsubscribePush(
        canCallRemote
          ? () =>
              withTimeout(
                convexMutations.unregisterPushSubscription({ deviceId: DEVICE_ID }),
                LOGOUT_REMOTE_TIMEOUT_MS
              )
          : undefined
      );

      if (isConvexConfigured) {
        try {
          if (isConvexConnectedRef.current) {
            await withTimeout(convexSignOut(), LOGOUT_REMOTE_TIMEOUT_MS);
          } else {
            convexClient.clearAuth();
          }
        } catch (err) {
          console.warn('Convex signOut error (falling back to local clearAuth):', err);
          try {
            convexClient.clearAuth();
          } catch {
            // Ignore
          }
        }
      }

      authService.logout();
      wasConvexAuthenticatedRef.current = false;
      await resetLocalAuthUi({ isTokenExpired: false, wipeCaches: true });
    } finally {
      isLoggingOutRef.current = false;
      setIsLoggingOut(false);
    }
  }, [
    isConvexConfigured,
    isConvexAuthReady,
    auth.isTokenExpired,
    convexSignOut,
    convexMutations,
    resetLocalAuthUi,
  ]);

  const loginWithGoogle = useCallback(
    async (idToken: string): Promise<void> => {
      authEpochRef.current += 1;
      setAuth((prev) => ({ ...prev, isSyncing: true, syncError: null }));
      try {
        const payload = parseGoogleJwt(idToken);
        if (!payload || !payload.sub) {
          throw new Error('Invalid Google identity token');
        }

        const priorOwner = getLocalDataOwnerUserId();
        const priorEmail = auth.user?.email;
        if (priorOwner && priorEmail && payload.email && priorEmail !== payload.email) {
          await notificationService.unsubscribePush(
            isConvexConfigured && isConvexAuthReady && isConvexConnectedRef.current
              ? () =>
                  withTimeout(
                    convexMutations.unregisterPushSubscription({ deviceId: DEVICE_ID }),
                    LOGOUT_REMOTE_TIMEOUT_MS
                  )
              : undefined
          );
          const { cleanProfile, cleanSettings } = await clearAccountLocalCaches();
          setLocalProfile(cleanProfile);
          setLocalSettings(cleanSettings);
        }

        if (isConvexConfigured) {
          const res = await convexSignIn('google-id-token', { token: idToken });
          const signedIn =
            Boolean(res?.signingIn) || authService.hasConvexAuthSession(convexUrl);
          if (!signedIn) {
            throw new Error('Could not establish cloud session. Please try again.');
          }
        }

        const user = buildProfileFromJwt(payload, profileRef.current);
        authService.saveAuthUser(user);

        setAuth({
          isAuthenticated: true,
          user,
          token: null,
          isSyncing: false,
          lastSyncedAt: null,
          syncError: null,
          isTokenExpired: false,
        });

        const updatedProfile: UserProfile = {
          ...profileRef.current,
          id: user.id,
          email: user.email,
          avatarUrl: user.avatarUrl,
          avatarEmoji: profileRef.current.avatarEmoji || '',
          displayName: user.displayName || profileRef.current.displayName,
        };
        await profileRepository.save(updatedProfile);
        setLocalProfile(updatedProfile);
      } catch (err) {
        const message = (err as Error).message || 'Google sign-in failed';
        setAuth((prev) => ({
          ...prev,
          isSyncing: false,
          syncError: message,
        }));
        throw err;
      }
    },
    [
      isConvexConfigured,
      isConvexAuthReady,
      auth.user?.email,
      convexSignIn,
      convexMutations,
    ]
  );

  // Initial local load with cancellation + authEpoch guard
  useEffect(() => {
    let cancelled = false;
    const startEpoch = authEpochRef.current;

    async function init() {
      const [loadedProfile, loadedSettings] = await Promise.all([
        profileRepository.get(),
        settingsRepository.get(),
      ]);

      if (cancelled || authEpochRef.current !== startEpoch) return;

      setLocalProfile(loadedProfile);
      setLocalSettings(loadedSettings);

      const storedUser = authService.getStoredUser();
      const hasConvexSession = authService.hasConvexAuthSession(convexUrl);

      if (hasConvexSession && isConvexConfigured) {
        setAuth((prev) => ({
          ...prev,
          isAuthenticated: true,
          user: storedUser || loadedProfile,
          token: null,
          isTokenExpired: false,
        }));
      } else if (!storedUser) {
        setAuth({
          isAuthenticated: false,
          user: null,
          token: null,
          isSyncing: false,
          lastSyncedAt: null,
          syncError: null,
          isTokenExpired: false,
        });
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, [isConvexConfigured]);

  useEffect(() => {
    if (isConvexAuthAuthenticated && !isConvexAuthLoading) {
      wasConvexAuthenticatedRef.current = true;
    }
  }, [isConvexAuthAuthenticated, isConvexAuthLoading]);

  // Session expiry / unauthenticated cleanup
  useEffect(() => {
    if (
      !isConvexConfigured ||
      isConvexAuthLoading ||
      isLoggingOutRef.current ||
      isConvexAuthAuthenticated
    ) {
      return;
    }

    if (wasConvexAuthenticatedRef.current || auth.isAuthenticated) {
      wasConvexAuthenticatedRef.current = false;
      void notificationService.unsubscribePush();
      const shouldMarkExpired = Boolean(auth.isAuthenticated || authService.getStoredUser());
      void resetLocalAuthUi({
        isTokenExpired: shouldMarkExpired,
        wipeCaches: false,
      });
    }
  }, [
    isConvexConfigured,
    isConvexAuthLoading,
    isConvexAuthAuthenticated,
    auth.isAuthenticated,
    resetLocalAuthUi,
  ]);

  // Storage listener for auth/settings/profile changes
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === AUTH_USER_KEY && e.newValue === null && !isLoggingOutRef.current) {
        if (!authService.hasConvexAuthSession(convexUrl)) {
          void notificationService.unsubscribePush();
          void resetLocalAuthUi({ isTokenExpired: false, wipeCaches: false });
        }
      } else if (e.key === 'pomodor:settings_v1' && e.newValue) {
        setLocalSettings(settingsRepository.getSync());
      } else if (e.key === 'pomodor:profile_v1' && e.newValue) {
        void profileRepository.get().then((p) => setLocalProfile(p));
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', handleStorage);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', handleStorage);
      }
    };
  }, [resetLocalAuthUi]);

  // Google Identity Services initialization
  useEffect(() => {
    let initialized = false;
    let attempts = 0;
    let interval: ReturnType<typeof setInterval> | null = null;

    const initGoogleAccounts = () => {
      if (initialized || typeof window === 'undefined' || !(window as any).google?.accounts?.id) {
        return false;
      }
      try {
        (window as any).google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          auto_select: true,
          callback: async (response: any) => {
            if (response?.credential) {
              try {
                await loginWithGoogle(response.credential);
              } catch (err) {
                console.warn('Google sign-in callback error:', err);
              }
            }
          },
        });
        initialized = true;
        return true;
      } catch {
        return false;
      }
    };

    const startPolling = () => {
      if (initGoogleAccounts()) return;
      if (interval) clearInterval(interval);
      attempts = 0;
      interval = setInterval(() => {
        attempts += 1;
        if (initGoogleAccounts() || attempts >= MAX_GIS_INIT_ATTEMPTS) {
          if (interval) {
            clearInterval(interval);
            interval = null;
          }
        }
      }, 500);
    };

    startPolling();
    const handleOnline = () => {
      if (!initialized) startPolling();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
    }

    return () => {
      if (interval) clearInterval(interval);
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
      }
    };
  }, [loginWithGoogle]);

  const syncWithCloud = useCallback(async (): Promise<void> => {
    if (!isEffectiveAuthenticated || isLoggingOutRef.current) return;
    if (isConvexConfigured && !isConvexConnectedRef.current) {
      setAuth((prev) => ({
        ...prev,
        isSyncing: false,
        syncError: 'You are currently offline.',
      }));
      return;
    }
    setAuth((prev) => ({
      ...prev,
      isSyncing: false,
      lastSyncedAt: new Date().toISOString(),
      syncError: null,
    }));
  }, [isConvexConfigured, isEffectiveAuthenticated]);

  const updateProfile = useCallback(
    async (newProfile: Partial<UserProfile>): Promise<void> => {
      const patchPayload = {
        ...(newProfile.displayName !== undefined ? { displayName: newProfile.displayName } : {}),
        ...(newProfile.avatarEmoji !== undefined ? { avatarEmoji: newProfile.avatarEmoji } : {}),
        ...(newProfile.dailyGoalMinutes !== undefined
          ? { dailyGoalMinutes: newProfile.dailyGoalMinutes }
          : {}),
      };

      if (isConvexConfigured && isEffectiveAuthenticated) {
        if (Object.keys(patchPayload).length > 0 && isConvexAuthReady) {
          await convexMutations.updateProfile(patchPayload);
        }
        return;
      }

      const latestStored = await profileRepository.get();
      const merged = sanitizeProfile({ ...latestStored, ...profileRef.current, ...newProfile });
      setLocalProfile(merged);
      await profileRepository.save(merged);
      markGuestDataModified();
    },
    [isConvexConfigured, isEffectiveAuthenticated, isConvexAuthReady, convexMutations]
  );

  const resetProfileToDefaults = useCallback(async (): Promise<UserProfile> => {
    const defaultProfile = await profileRepository.resetToDefaults();
    setLocalProfile(defaultProfile);
    const patch = {
      displayName: defaultProfile.displayName,
      avatarEmoji: defaultProfile.avatarEmoji,
      dailyGoalMinutes: defaultProfile.dailyGoalMinutes,
    };

    if (isConvexConfigured && isEffectiveAuthenticated && isConvexAuthReady) {
      await convexMutations.updateProfile(patch);
    }
    return defaultProfile;
  }, [isConvexConfigured, isEffectiveAuthenticated, isConvexAuthReady, convexMutations]);

  const updateSettings = useCallback(
    async (newValues: Partial<UserSettings>): Promise<void> => {
      const definedLocalValues = Object.fromEntries(
        Object.entries(pickLocalSettings(newValues)).filter(([, v]) => v !== undefined)
      ) as Partial<UserSettings>;

      if (isConvexConfigured && isEffectiveAuthenticated) {
        if (newValues.notificationsEnabled !== undefined) {
          const updatedLocal = {
            ...settingsRepository.getSync(),
            notificationsEnabled: newValues.notificationsEnabled,
          };
          setLocalSettings(updatedLocal);
          await settingsRepository.save(updatedLocal);
        }

        const cleanConvexPatch = Object.fromEntries(
          Object.entries(pickConvexSettings(newValues)).filter(([, v]) => v !== undefined)
        );
        if (Object.keys(cleanConvexPatch).length > 0 && isConvexAuthReady) {
          await convexMutations.updateSettings(cleanConvexPatch);
        }
        return;
      }

      const merged = {
        ...settingsRepository.getSync(),
        ...settingsRef.current,
        ...definedLocalValues,
      };
      setLocalSettings(merged);
      await settingsRepository.save(merged);
      markGuestDataModified();
    },
    [isConvexConfigured, isEffectiveAuthenticated, isConvexAuthReady, convexMutations]
  );

  const resetSettingsToDefaults = useCallback(async (): Promise<UserSettings> => {
    const defaultSettings = await settingsRepository.resetToDefaults();
    setLocalSettings(defaultSettings);

    const canCallRemote =
      isConvexConfigured &&
      isConvexAuthReady &&
      isConvexConnectedRef.current &&
      !auth.isTokenExpired;

    void notificationService.unsubscribePush(
      canCallRemote
        ? () => convexMutations.unregisterPushSubscription({ deviceId: DEVICE_ID })
        : undefined
    );

    if (isConvexConfigured && isEffectiveAuthenticated && isConvexAuthReady) {
      await convexMutations.updateSettings(pickConvexSettings(defaultSettings));
    }
    return defaultSettings;
  }, [
    isConvexConfigured,
    isEffectiveAuthenticated,
    isConvexAuthReady,
    auth.isTokenExpired,
    convexMutations,
  ]);

  const { pushStatus, syncPushSubscription } = usePushSubscriptionSync({
    notificationService,
    isConvexConfigured,
    isEffectiveAuthenticated,
    isConvexAuthReady,
    isConvexConnected,
    currentUserId: convexUser?.id ?? null,
    isLoggingOutRef,
    notificationsEnabled: settings.notificationsEnabled,
    settingsRef,
    vapidPublicKey,
    isServerSubscriptionRegistered: devicePushStatus?.registered,
    registerPushSubscription: convexMutations.registerPushSubscription,
    unregisterPushSubscription: convexMutations.unregisterPushSubscription,
  });

  const value = useMemo<AuthProfileContextValue>(
    () => ({
      auth,
      isEffectiveAuthenticated,
      isConvexAuthReady,
      isConvexAuthAuthenticated,
      isConvexAuthLoading,
      isLoggingOut,
      loginWithGoogle,
      logout,
      syncWithCloud,
      profile,
      updateProfile,
      resetProfileToDefaults,
      settings,
      updateSettings,
      resetSettingsToDefaults,
      sound: soundService,
      notifications: notificationService,
      convexSync,
      pushStatus,
      syncPushSubscription,
    }),
    [
      auth,
      isEffectiveAuthenticated,
      isConvexAuthReady,
      isConvexAuthAuthenticated,
      isConvexAuthLoading,
      isLoggingOut,
      loginWithGoogle,
      logout,
      syncWithCloud,
      profile,
      updateProfile,
      resetProfileToDefaults,
      settings,
      updateSettings,
      resetSettingsToDefaults,
      convexSync,
      pushStatus,
      syncPushSubscription,
    ]
  );

  return (
    <AuthProfileContext.Provider value={value}>
      {children}
    </AuthProfileContext.Provider>
  );
};

export const useAuthProfile = (): AuthProfileContextValue => {
  const context = useContext(AuthProfileContext);
  if (!context) {
    throw new Error('useAuthProfile must be used within an AuthProfileProvider');
  }
  return context;
};
