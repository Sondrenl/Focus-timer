import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import { useConvexAuth } from 'convex/react';
import { useAuthActions } from '@convex-dev/auth/react';
import { useSignInWithGoogle, useOauth } from '@convex-dev/auth/methods/google/react';
import { api } from '../../convex/_generated/api';
import { UserSettings } from '../types/settings';
import { UserProfile, DEFAULT_PROFILE, AuthState } from '../types/user';
import { convexClient } from '../services/convex/ConvexClient';
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
  markGuestDataModified,
  setLocalDataOwner,
} from '../services/sync/offlineOutbox';
import {
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

const INITIAL_AUTH_STATE: AuthState = {
  isAuthenticated: false,
  user: null,
  token: null,
  isSyncing: false,
  lastSyncedAt: null,
  syncError: null,
  isTokenExpired: false,
};

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
  isAuthenticated: boolean;
  isLoggingOut: boolean;
  loginWithGoogle: () => Promise<void>;
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
  const [auth, setAuth] = useState<AuthState>(INITIAL_AUTH_STATE);
  const [isLoggingOut, setIsLoggingOut] = useState<boolean>(false);

  const authEpochRef = useRef<number>(0);
  const isLoggingOutRef = useRef<boolean>(false);
  const wasConvexAuthenticatedRef = useRef<boolean>(false);

  const {
    isAuthenticated: isConvexAuthAuthenticated,
    isLoading: isConvexAuthLoading,
  } = useConvexAuth();
  const { signOut: convexSignOut } = useAuthActions();
  const { signIn: startGoogleSignIn } = useSignInWithGoogle(api.auth);
  const { flowError: oauthFlowError } = useOauth();

  const isAuthenticated =
    !isLoggingOut && isConvexAuthAuthenticated && !isConvexAuthLoading;

  const convexSync = useConvexSync(isAuthenticated);
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
    isAuthenticated &&
    Boolean(convexUser);

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
        ...INITIAL_AUTH_STATE,
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
        isAuthenticated &&
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

      wasConvexAuthenticatedRef.current = false;
      await resetLocalAuthUi({ isTokenExpired: false, wipeCaches: true });
    } finally {
      isLoggingOutRef.current = false;
      setIsLoggingOut(false);
    }
  }, [
    isConvexConfigured,
    isAuthenticated,
    auth.isTokenExpired,
    convexSignOut,
    convexMutations,
    resetLocalAuthUi,
  ]);

  const loginWithGoogle = useCallback(async (): Promise<void> => {
    if (!isConvexConfigured) {
      setAuth((prev) => ({
        ...prev,
        isSyncing: false,
        syncError: 'Cloud sync is not configured for this environment.',
      }));
      return;
    }

    authEpochRef.current += 1;
    setAuth((prev) => ({ ...prev, isSyncing: true, syncError: null }));
    try {
      const redirectTo =
        typeof window !== 'undefined'
          ? `${window.location.origin}${window.location.pathname}`
          : undefined;
      const res = await startGoogleSignIn(redirectTo ? { redirectTo } : undefined);
      if (res && 'status' in res && res.status === 'error') {
        const errorCode =
          typeof res.userError === 'object' && res.userError !== null && 'error' in res.userError
            ? String((res.userError as { error: unknown }).error)
            : 'Google sign-in failed';
        throw new Error(errorCode);
      }
    } catch (err) {
      const message = (err as Error).message || 'Google sign-in failed';
      setAuth((prev) => ({
        ...prev,
        isSyncing: false,
        syncError: message,
      }));
    }
  }, [isConvexConfigured, startGoogleSignIn]);

  // Initial local profile/settings load with cancellation + authEpoch guard
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
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, []);

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

    if (wasConvexAuthenticatedRef.current) {
      wasConvexAuthenticatedRef.current = false;
      // Preserve the browser PushSubscription across transient token/network flickers on mobile
      // wake so re-authentication can seamlessly re-sync without requiring a fresh user gesture.
      // Explicit logout() still unsubscribes at both Convex and OS PushManager levels.
      notificationService.resetPushStatus('unsubscribed');
      void resetLocalAuthUi({
        isTokenExpired: true,
        wipeCaches: false,
      });
    }
  }, [
    isConvexConfigured,
    isConvexAuthLoading,
    isConvexAuthAuthenticated,
    resetLocalAuthUi,
  ]);

  // Storage listener for cross-tab settings/profile changes
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'pomodor:settings_v1' && e.newValue) {
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
  }, []);

  // Surface any post-redirect OAuth flow errors from @convex-dev/auth
  useEffect(() => {
    if (!oauthFlowError) return;
    setAuth((prev) => ({
      ...prev,
      isSyncing: false,
      syncError: `Google sign-in failed (${oauthFlowError.error}). Please try again.`,
    }));
  }, [oauthFlowError]);

  const syncWithCloud = useCallback(async (): Promise<void> => {
    if (!isAuthenticated || isLoggingOutRef.current) return;
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
  }, [isConvexConfigured, isAuthenticated]);

  const updateProfile = useCallback(
    async (newProfile: Partial<UserProfile>): Promise<void> => {
      const patchPayload = {
        ...(newProfile.displayName !== undefined ? { displayName: newProfile.displayName } : {}),
        ...(newProfile.avatarEmoji !== undefined ? { avatarEmoji: newProfile.avatarEmoji } : {}),
        ...(newProfile.dailyGoalMinutes !== undefined
          ? { dailyGoalMinutes: newProfile.dailyGoalMinutes }
          : {}),
      };

      if (isConvexConfigured && isAuthenticated) {
        if (Object.keys(patchPayload).length > 0) {
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
    [isConvexConfigured, isAuthenticated, convexMutations]
  );

  const resetProfileToDefaults = useCallback(async (): Promise<UserProfile> => {
    const defaultProfile = await profileRepository.resetToDefaults();
    setLocalProfile(defaultProfile);
    const patch = {
      displayName: defaultProfile.displayName,
      avatarEmoji: defaultProfile.avatarEmoji,
      dailyGoalMinutes: defaultProfile.dailyGoalMinutes,
    };

    if (isConvexConfigured && isAuthenticated) {
      await convexMutations.updateProfile(patch);
    }
    return defaultProfile;
  }, [isConvexConfigured, isAuthenticated, convexMutations]);

  const updateSettings = useCallback(
    async (newValues: Partial<UserSettings>): Promise<void> => {
      const definedLocalValues = Object.fromEntries(
        Object.entries(pickLocalSettings(newValues)).filter(([, v]) => v !== undefined)
      ) as Partial<UserSettings>;

      if (isConvexConfigured && isAuthenticated) {
        if (newValues.notificationsEnabled !== undefined) {
          const updatedLocal = {
            ...settingsRepository.getSync(),
            notificationsEnabled: newValues.notificationsEnabled,
          };
          settingsRef.current = {
            ...settingsRef.current,
            notificationsEnabled: newValues.notificationsEnabled,
          };
          setLocalSettings(updatedLocal);
          await settingsRepository.save(updatedLocal);
        }

        const cleanConvexPatch = Object.fromEntries(
          Object.entries(pickConvexSettings(newValues)).filter(([, v]) => v !== undefined)
        );
        if (Object.keys(cleanConvexPatch).length > 0) {
          await convexMutations.updateSettings(cleanConvexPatch);
        }
        return;
      }

      const merged = {
        ...settingsRepository.getSync(),
        ...settingsRef.current,
        ...definedLocalValues,
      };
      settingsRef.current = merged;
      setLocalSettings(merged);
      await settingsRepository.save(merged);
      markGuestDataModified();
    },
    [isConvexConfigured, isAuthenticated, convexMutations]
  );

  const resetSettingsToDefaults = useCallback(async (): Promise<UserSettings> => {
    const defaultSettings = await settingsRepository.resetToDefaults();
    setLocalSettings(defaultSettings);

    const canCallRemote =
      isConvexConfigured &&
      isAuthenticated &&
      isConvexConnectedRef.current &&
      !auth.isTokenExpired;

    void notificationService.unsubscribePush(
      canCallRemote
        ? () => convexMutations.unregisterPushSubscription({ deviceId: DEVICE_ID })
        : undefined
    );

    if (isConvexConfigured && isAuthenticated) {
      await convexMutations.updateSettings(pickConvexSettings(defaultSettings));
    }
    return defaultSettings;
  }, [
    isConvexConfigured,
    isAuthenticated,
    auth.isTokenExpired,
    convexMutations,
  ]);

  const { pushStatus, syncPushSubscription } = usePushSubscriptionSync({
    notificationService,
    isConvexConfigured,
    isAuthenticated,
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
      isAuthenticated,
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
      isAuthenticated,
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
