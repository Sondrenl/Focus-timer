import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from 'react';
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
import {
  broadcastAuthEvent,
  broadcastProfile,
  broadcastSettings,
  subscribeAuthEvent,
  subscribeProfile,
  subscribeReset,
  subscribeSettings,
} from '../services/timer/TimerBroadcast';
import { useConvexSync } from '../services/convex/useConvexSync';
import { usePushSubscriptionSync } from '../hooks/usePushSubscriptionSync';
import { DEVICE_ID, TIMER_STORAGE_KEY } from './timer/timerPersistence';
import { sanitizeProfile } from '../services/repository/ProfileRepository';
import { LAST_DAY_RESET_STORAGE_KEY } from '../utils/newDayCheck';
import { clearAllHydrationWatermarks } from '../utils/backupSanitizers';
import {
  clearGuestDataModifiedFlag,
  clearOfflineOutbox,
  enqueueOutboxOperation,
  getLocalDataOwner,
  getLocalDataOwnerUserId,
  getPendingProfilePatch,
  getPendingSettingsPatch,
  hasGuestDataBeenModified,
  markGuestDataModified,
  removeOutboxOperation,
  setLocalDataOwner,
  subscribeLocalDataOwnerChange,
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
    const timer = setTimeout(() => {
      reject(new Error('Operation timed out'));
    }, timeoutMs);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
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
  clearAllHydrationWatermarks();
  clearOfflineOutbox();
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

export interface TelemetryControlOptions {
  skipTelemetry?: boolean;
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
  registerFullSyncHandler: (handler: (() => Promise<void>) | null) => void;
  profile: UserProfile;
  updateProfile: (
    newProfile: Partial<UserProfile>,
    options?: TelemetryControlOptions
  ) => Promise<void>;
  resetProfileToDefaults: (options?: TelemetryControlOptions) => Promise<UserProfile>;
  settings: UserSettings;
  updateSettings: (
    newSettings: Partial<UserSettings>,
    options?: TelemetryControlOptions
  ) => Promise<void>;
  resetSettingsToDefaults: (options?: TelemetryControlOptions) => Promise<UserSettings>;
  sound: SoundService;
  notifications: NotificationService;
  convexSync: ReturnType<typeof useConvexSync>;
  pushStatus: PushSubscriptionStatus;
  syncPushSubscription: () => Promise<{ ok: boolean; status: PushSubscriptionStatus; reason?: string }>;
}

const AuthProfileContext = createContext<AuthProfileContextValue | null>(null);

export const AuthProfileProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [settings, setSettings] = useState<UserSettings>(() => settingsRepository.getSync());
  const [auth, setAuth] = useState<AuthState>(() => authService.getInitialAuthState(convexUrl));
  const [isLoggingOut, setIsLoggingOut] = useState<boolean>(false);

  const settingsRef = useRef<UserSettings>(settings);
  settingsRef.current = settings;

  const profileRef = useRef<UserProfile>(profile);
  profileRef.current = profile;

  const authEpochRef = useRef<number>(0);
  const isLoggingOutRef = useRef<boolean>(false);
  const hasAttemptedLegacyUpgradeRef = useRef<boolean>(false);
  const wasConvexAuthenticatedRef = useRef<boolean>(false);
  const fullSyncHandlerRef = useRef<(() => Promise<void>) | null>(null);

  const lastLocalSettingsEditMsRef = useRef<number>(0);
  const lastLocalProfileEditMsRef = useRef<number>(0);
  const pendingSettingsMutationsRef = useRef<number>(0);
  const pendingProfileMutationsRef = useRef<number>(0);
  const lastPersistedAuthUserJsonRef = useRef<string | null>(null);

  const { isAuthenticated: isConvexAuthAuthenticated, isLoading: isConvexAuthLoading } = useConvexAuth();
  const { signIn: convexSignIn, signOut: convexSignOut } = useAuthActions();

  // ConvexAuthProvider is the single source of truth for WebSocket authentication (Decision 2A).
  // Queries & mutations wait strictly for isConvexAuthReady so no unauthenticated null bursts fire.
  const isConvexAuthReady =
    !isLoggingOut &&
    isConvexAuthAuthenticated &&
    !isConvexAuthLoading;

  const isEffectiveAuthenticated = !isLoggingOut && (
    isConvexAuthLoading ? auth.isAuthenticated : isConvexAuthAuthenticated
  );

  const convexSync = useConvexSync(isEffectiveAuthenticated, isConvexAuthReady);
  const {
    isConvexConfigured,
    isConvexConnected,
    convexUser,
    vapidPublicKey,
    devicePushStatus,
    mutations: convexMutations,
  } = convexSync;

  const convexUserRef = useRef(convexUser);
  convexUserRef.current = convexUser;

  const isConvexConnectedRef = useRef(isConvexConnected);
  isConvexConnectedRef.current = isConvexConnected;

  const getActiveOwnerUserId = useCallback((): string | null => {
    return (
      convexUserRef.current?.id ??
      getLocalDataOwnerUserId() ??
      auth.user?.id ??
      null
    );
  }, [auth.user?.id]);

  const registerFullSyncHandler = useCallback((handler: (() => Promise<void>) | null) => {
    fullSyncHandlerRef.current = handler;
  }, []);

  const resetLocalAuthUi = useCallback(
    async (options: { isTokenExpired?: boolean; wipeCaches?: boolean } = {}) => {
      lastPersistedAuthUserJsonRef.current = null;
      lastLocalSettingsEditMsRef.current = 0;
      lastLocalProfileEditMsRef.current = 0;
      pendingSettingsMutationsRef.current = 0;
      pendingProfileMutationsRef.current = 0;

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
        profileRef.current = cleanProfile;
        settingsRef.current = cleanSettings;
        setProfile(cleanProfile);
        setSettings(cleanSettings);
      } else {
        const cleanProfile = await profileRepository.resetToDefaults();
        profileRef.current = cleanProfile;
        setProfile(cleanProfile);
      }
    },
    []
  );

  const logout = useCallback(async (): Promise<void> => {
    if (isLoggingOutRef.current) return;
    isLoggingOutRef.current = true;
    setIsLoggingOut(true);
    authEpochRef.current += 1;

    // Immediately notify local contexts & peer tabs so push self-heal never resurrects
    // the device subscription while remote unregister/signOut is in flight.
    broadcastAuthEvent({ action: 'logout' });

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
            // Avoid hanging offline: clear client auth immediately without waiting on socket
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

        // If switching directly from an already-signed-in account (without calling logout first),
        // unsubscribe push and wipe the prior account's cached data before signing into the new account.
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
          profileRef.current = cleanProfile;
          settingsRef.current = cleanSettings;
          setProfile(cleanProfile);
          setSettings(cleanSettings);
        }

        if (isConvexConfigured) {
          const res = await convexSignIn('google-id-token', { token: idToken });
          const signedIn =
            Boolean(res?.signingIn) || authService.hasConvexAuthSession(convexUrl);
          if (!signedIn) {
            throw new Error('Could not establish cloud session. Please try again.');
          }
        }

        // Never retain the 1-hour raw Google ID token once a 30-day @convex-dev/auth session exists.
        authService.clearLegacyToken();

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
        profileRef.current = updatedProfile;
        await profileRepository.save(updatedProfile);
        setProfile(updatedProfile);
        broadcastAuthEvent({ action: 'login' });
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

  // Initial local load with cancellation + authEpoch guard so init() never clobbers login/logout
  useEffect(() => {
    let cancelled = false;
    const startEpoch = authEpochRef.current;

    async function init() {
      const [loadedProfile, loadedSettings] = await Promise.all([
        profileRepository.get(),
        settingsRepository.get(),
      ]);

      if (cancelled || authEpochRef.current !== startEpoch) return;

      profileRef.current = loadedProfile;
      settingsRef.current = loadedSettings;
      setProfile(loadedProfile);
      setSettings(loadedSettings);

      const storedUser = authService.getStoredUser();
      const hasConvexSession = authService.hasConvexAuthSession(convexUrl);

      if (hasConvexSession && isConvexConfigured) {
        // Clear any leftover legacy Google JWT from before 30-day session migration
        authService.clearLegacyToken();
        const resolvedUser = storedUser || loadedProfile;
        setAuth((prev) => ({
          ...prev,
          isAuthenticated: true,
          user: resolvedUser,
          token: null,
          isTokenExpired: false,
        }));
      } else if (!storedUser && !authService.getStoredToken()) {
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

  // Track when Convex Auth confirms authenticated state
  useEffect(() => {
    if (isConvexAuthAuthenticated && !isConvexAuthLoading) {
      wasConvexAuthenticatedRef.current = true;
    }
  }, [isConvexAuthAuthenticated, isConvexAuthLoading]);

  // One-time silent upgrade of a valid legacy Google JWT (auth_token_v2) into a 30-day @convex-dev/auth session,
  // and authoritative stale/expired session cleanup once Convex Auth finishes loading.
  useEffect(() => {
    if (!isConvexConfigured || isConvexAuthLoading || isLoggingOutRef.current) {
      return;
    }

    if (isConvexAuthAuthenticated) {
      authService.clearLegacyToken();
      return;
    }

    // Convex Auth resolved as unauthenticated.
    const storedToken = authService.getStoredToken();
    if (
      storedToken &&
      !authService.isTokenExpired(storedToken) &&
      !hasAttemptedLegacyUpgradeRef.current &&
      isConvexConnectedRef.current
    ) {
      hasAttemptedLegacyUpgradeRef.current = true;
      void loginWithGoogle(storedToken).catch(() => {
        authService.clearLegacyToken();
      });
      return;
    }

    // Clean up any expired legacy token and clear stale local auth state (never stay ghost-authenticated)
    const hadSessionEvidence = Boolean(
      wasConvexAuthenticatedRef.current || auth.isAuthenticated || storedToken
    );
    if (storedToken) {
      authService.clearLegacyToken();
    }

    if (hadSessionEvidence) {
      wasConvexAuthenticatedRef.current = false;
      void notificationService.unsubscribePush();
      const shouldMarkExpired = Boolean(
        auth.isAuthenticated || storedToken || authService.getStoredUser()
      );
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
    loginWithGoogle,
    resetLocalAuthUi,
  ]);

  // Multi-tab sync: logout, settings (incl. per-device notificationsEnabled), profile, and factory reset
  useEffect(() => {
    const unsubAuth = subscribeAuthEvent((payload, { isRemoteTab }) => {
      if (payload.action === 'logout' && isRemoteTab) {
        isLoggingOutRef.current = true;
        authEpochRef.current += 1;
        wasConvexAuthenticatedRef.current = false;
        void notificationService.unsubscribePush();
        try {
          convexClient.clearAuth();
        } catch {
          // Ignore
        }
        void resetLocalAuthUi({ isTokenExpired: false, wipeCaches: false }).finally(() => {
          settingsRepository.get().then((s) => {
            settingsRef.current = s;
            setSettings(s);
          });
          isLoggingOutRef.current = false;
        });
      }
    });

    const unsubSettings = subscribeSettings((incoming) => {
      const merged: UserSettings = { ...settingsRef.current, ...incoming };
      settingsRef.current = merged;
      setSettings(merged);
    });

    const unsubProfile = subscribeProfile((incoming) => {
      const merged = sanitizeProfile({ ...profileRef.current, ...incoming });
      profileRef.current = merged;
      setProfile(merged);
    });

    const unsubReset = subscribeReset((scope) => {
      if (scope === 'factory-reset') {
        settingsRepository.get().then((loadedSettings) => {
          settingsRef.current = loadedSettings;
          setSettings(loadedSettings);
        });
        profileRepository.get().then((loadedProfile) => {
          profileRef.current = loadedProfile;
          setProfile(loadedProfile);
        });
      }
    });

    // Cross-tab fallback via storage events (e.g. if BroadcastChannel is unavailable)
    const handleStorage = (e: StorageEvent) => {
      if (e.key === AUTH_USER_KEY && e.newValue === null && !isLoggingOutRef.current) {
        if (!authService.hasConvexAuthSession(convexUrl)) {
          void notificationService.unsubscribePush();
          void resetLocalAuthUi({ isTokenExpired: false, wipeCaches: false });
        }
      } else if (e.key === 'pomodor:settings_v1' && e.newValue) {
        const fresh = settingsRepository.getSync();
        settingsRef.current = fresh;
        setSettings(fresh);
      } else if (e.key === 'pomodor:profile_v1' && e.newValue) {
        void profileRepository.get().then((fresh) => {
          profileRef.current = fresh;
          setProfile(fresh);
        });
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', handleStorage);
    }

    return () => {
      unsubAuth();
      unsubSettings();
      unsubProfile();
      unsubReset();
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', handleStorage);
      }
    };
  }, [resetLocalAuthUi]);

  // Reactive adoption of Convex user profile & settings
  useEffect(() => {
    if (!isConvexAuthReady || !convexUser || isLoggingOutRef.current) return;

    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const applyRemoteUser = () => {
      if (cancelled || isLoggingOutRef.current) return;

      // While guest data modified locally is awaiting migration/reconciliation into this account,
      // avoid overwriting local guest settings/profile before useCloudMigration reads them.
      const owner = getLocalDataOwner();
      const waitingOnGuestReconciliation =
        owner !== `user:${convexUser.id}` &&
        (owner === 'guest' || owner === null) &&
        hasGuestDataBeenModified();
      if (waitingOnGuestReconciliation) {
        return;
      }

      const now = Date.now();
      const pendingOutboxSettings = getPendingSettingsPatch(convexUser.id);
      const pendingOutboxProfile = getPendingProfilePatch(convexUser.id);

      if (
        convexUser.settings &&
        pendingSettingsMutationsRef.current === 0 &&
        now - lastLocalSettingsEditMsRef.current >= 2000
      ) {
        const cur = settingsRef.current;
        // Preserve any field that still has an un-flushed offline outbox patch,
        // and always preserve per-device notificationsEnabled.
        const s: UserSettings = {
          ...convexUser.settings,
          ...(pendingOutboxSettings ?? {}),
          notificationsEnabled: cur.notificationsEnabled,
        };
        const settingsChanged =
          cur.workDurationMinutes !== s.workDurationMinutes ||
          cur.shortBreakDurationMinutes !== s.shortBreakDurationMinutes ||
          cur.longBreakDurationMinutes !== s.longBreakDurationMinutes ||
          cur.longBreakInterval !== s.longBreakInterval ||
          cur.autoStartBreaks !== s.autoStartBreaks ||
          cur.autoStartPomodoros !== s.autoStartPomodoros ||
          cur.soundVolume !== s.soundVolume ||
          cur.soundEnabled !== s.soundEnabled ||
          Boolean(cur.keepAwake) !== Boolean(s.keepAwake);

        if (settingsChanged) {
          settingsRef.current = s;
          setSettings(s);
          void settingsRepository.save(s);
        }
      }

      if (
        pendingProfileMutationsRef.current === 0 &&
        now - lastLocalProfileEditMsRef.current >= 2000
      ) {
        const curProf = profileRef.current;
        const updatedProfile = sanitizeProfile({
          ...curProf,
          id: convexUser.id,
          email: convexUser.email,
          displayName: pendingOutboxProfile?.displayName ?? convexUser.displayName,
          avatarUrl: convexUser.avatarUrl,
          avatarEmoji: pendingOutboxProfile?.avatarEmoji ?? convexUser.avatarEmoji,
          dailyGoalMinutes:
            pendingOutboxProfile?.dailyGoalMinutes ?? convexUser.dailyGoalMinutes,
        });
        const profileChanged =
          curProf.id !== updatedProfile.id ||
          curProf.email !== updatedProfile.email ||
          curProf.displayName !== updatedProfile.displayName ||
          curProf.avatarUrl !== updatedProfile.avatarUrl ||
          curProf.avatarEmoji !== updatedProfile.avatarEmoji ||
          curProf.dailyGoalMinutes !== updatedProfile.dailyGoalMinutes;

        if (profileChanged) {
          profileRef.current = updatedProfile;
          setProfile(updatedProfile);
          void profileRepository.save(updatedProfile);
        }

        const serializedAuthUser = JSON.stringify(updatedProfile);
        if (profileChanged || lastPersistedAuthUserJsonRef.current !== serializedAuthUser) {
          lastPersistedAuthUserJsonRef.current = serializedAuthUser;
          try {
            localStorage.setItem(AUTH_USER_KEY, serializedAuthUser);
          } catch {
            // Ignore storage access errors
          }
        }

        setAuth((prev) => {
          if (
            prev.isAuthenticated &&
            !prev.isTokenExpired &&
            prev.user?.id === updatedProfile.id &&
            prev.user?.email === updatedProfile.email &&
            prev.user?.displayName === updatedProfile.displayName &&
            prev.user?.avatarUrl === updatedProfile.avatarUrl &&
            prev.user?.avatarEmoji === updatedProfile.avatarEmoji &&
            prev.user?.dailyGoalMinutes === updatedProfile.dailyGoalMinutes
          ) {
            return prev;
          }
          return {
            ...prev,
            isAuthenticated: true,
            isTokenExpired: false,
            user: updatedProfile,
          };
        });
      }
    };

    const scheduleNextCheck = () => {
      if (cancelled) return;
      const now = Date.now();
      const settingsBlocked =
        Boolean(convexUser.settings) &&
        (pendingSettingsMutationsRef.current > 0 ||
          now - lastLocalSettingsEditMsRef.current < 2000);
      const profileBlocked =
        pendingProfileMutationsRef.current > 0 ||
        now - lastLocalProfileEditMsRef.current < 2000;

      if (!settingsBlocked && !profileBlocked) {
        return;
      }

      const settingsRemaining =
        pendingSettingsMutationsRef.current > 0
          ? 500
          : Math.max(0, 2000 - (now - lastLocalSettingsEditMsRef.current));
      const profileRemaining =
        pendingProfileMutationsRef.current > 0
          ? 500
          : Math.max(0, 2000 - (now - lastLocalProfileEditMsRef.current));

      const nextDelay = Math.min(
        settingsBlocked ? settingsRemaining : Infinity,
        profileBlocked ? profileRemaining : Infinity
      );
      if (!Number.isFinite(nextDelay)) return;

      retryTimer = setTimeout(() => {
        retryTimer = null;
        applyRemoteUser();
        scheduleNextCheck();
      }, Math.max(50, nextDelay + 50));
    };

    applyRemoteUser();
    scheduleNextCheck();

    const unsubOwner = subscribeLocalDataOwnerChange(() => {
      applyRemoteUser();
      scheduleNextCheck();
    });

    return () => {
      cancelled = true;
      unsubOwner();
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };
  }, [convexUser, isConvexAuthReady]);

  // Single Google Identity Services initialization with bounded retries & safe error handling
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
      if (!initialized) {
        startPolling();
      }
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
        syncError: 'You are currently offline. Changes are queued and will sync automatically when reconnected.',
      }));
      return;
    }
    if (isConvexConfigured && (!isConvexAuthReady || !convexUserRef.current)) {
      setAuth((prev) => ({
        ...prev,
        isSyncing: false,
        syncError: 'Cloud connection is still initializing. Please try again in a moment.',
      }));
      return;
    }

    setAuth((prev) => ({ ...prev, isSyncing: true, syncError: null }));
    try {
      // Flush all pending offline outbox operations (sessions, coffee, tags, telemetry, settings, profile)
      if (fullSyncHandlerRef.current) {
        await fullSyncHandlerRef.current();
      }

      if (isConvexConfigured && convexUserRef.current) {
        const ownerId = convexUserRef.current.id;
        const pendingProf = getPendingProfilePatch(ownerId);
        const pendingSet = getPendingSettingsPatch(ownerId);

        // Only push dirty/queued profile & settings patches instead of clobbering other devices
        if (pendingProf || pendingSet) {
          if (pendingProf) pendingProfileMutationsRef.current += 1;
          if (pendingSet) pendingSettingsMutationsRef.current += 1;
          try {
            const tasks: Promise<unknown>[] = [];
            if (pendingProf) {
              tasks.push(convexMutations.updateProfile(pendingProf));
            }
            if (pendingSet) {
              tasks.push(convexMutations.updateSettings(pendingSet));
            }
            await Promise.all(tasks);
          } finally {
            if (pendingProf) {
              pendingProfileMutationsRef.current = Math.max(
                0,
                pendingProfileMutationsRef.current - 1
              );
              lastLocalProfileEditMsRef.current = Date.now();
            }
            if (pendingSet) {
              pendingSettingsMutationsRef.current = Math.max(
                0,
                pendingSettingsMutationsRef.current - 1
              );
              lastLocalSettingsEditMsRef.current = Date.now();
            }
          }
        }
      }

      setAuth((prev) => ({
        ...prev,
        isSyncing: false,
        lastSyncedAt: new Date().toISOString(),
        syncError: null,
      }));
    } catch (err) {
      setAuth((prev) => ({
        ...prev,
        isSyncing: false,
        syncError: err instanceof Error ? err.message : 'Cloud sync failed',
      }));
    }
  }, [isConvexConfigured, isEffectiveAuthenticated, isConvexAuthReady, convexMutations]);

  const updateProfile = useCallback(
    async (
      newProfile: Partial<UserProfile>,
      options?: TelemetryControlOptions
    ): Promise<void> => {
      lastLocalProfileEditMsRef.current = Date.now();
      const latestStored = await profileRepository.get();
      const base = { ...latestStored, ...profileRef.current };
      const previousGoalMinutes = base.dailyGoalMinutes;
      const merged = sanitizeProfile({ ...base, ...newProfile });
      profileRef.current = merged;
      setProfile(merged);
      await profileRepository.save(merged);
      broadcastProfile({
        ...(newProfile.displayName !== undefined ? { displayName: merged.displayName } : {}),
        ...(newProfile.avatarEmoji !== undefined ? { avatarEmoji: merged.avatarEmoji } : {}),
        ...(newProfile.dailyGoalMinutes !== undefined
          ? { dailyGoalMinutes: merged.dailyGoalMinutes }
          : {}),
      });

      if (!options?.skipTelemetry && merged.dailyGoalMinutes !== previousGoalMinutes) {
        void telemetryTracker.onDailyGoalChanged({
          previousGoalMinutes,
          newGoalMinutes: merged.dailyGoalMinutes,
        });
      }

      if (!isEffectiveAuthenticated) {
        markGuestDataModified();
        return;
      }

      const patchPayload = {
        ...(newProfile.displayName !== undefined ? { displayName: merged.displayName } : {}),
        ...(newProfile.avatarEmoji !== undefined ? { avatarEmoji: merged.avatarEmoji } : {}),
        ...(newProfile.dailyGoalMinutes !== undefined
          ? { dailyGoalMinutes: merged.dailyGoalMinutes }
          : {}),
      };
      if (Object.keys(patchPayload).length === 0) return;

      if (isConvexConfigured) {
        const ownerId = getActiveOwnerUserId();
        const queuedOp = ownerId
          ? enqueueOutboxOperation(ownerId, { kind: 'update_profile', payload: patchPayload })
          : null;

        if (!isConvexAuthReady || !isConvexConnectedRef.current) {
          return;
        }

        pendingProfileMutationsRef.current += 1;
        convexMutations
          .updateProfile(patchPayload)
          .then(() => {
            if (queuedOp) {
              removeOutboxOperation(queuedOp.id);
            }
          })
          .catch((err) => {
            console.warn('Convex updateProfile failed (kept in offline outbox):', err);
          })
          .finally(() => {
            pendingProfileMutationsRef.current = Math.max(
              0,
              pendingProfileMutationsRef.current - 1
            );
            lastLocalProfileEditMsRef.current = Date.now();
          });
      }
    },
    [
      isConvexConfigured,
      isEffectiveAuthenticated,
      isConvexAuthReady,
      convexMutations,
      getActiveOwnerUserId,
    ]
  );

  const resetProfileToDefaults = useCallback(
    async (options?: TelemetryControlOptions): Promise<UserProfile> => {
      lastLocalProfileEditMsRef.current = Date.now();
      const previousGoalMinutes = profileRef.current.dailyGoalMinutes;
      const defaultProfile = await profileRepository.resetToDefaults();
      // Preserve authenticated identity fields (id/email/avatarUrl) when resetting customizable profile fields while signed in
      const resolvedProfile: UserProfile = isEffectiveAuthenticated
        ? {
            ...defaultProfile,
            id: profileRef.current.id || auth.user?.id || defaultProfile.id,
            email: profileRef.current.email || auth.user?.email,
            avatarUrl: profileRef.current.avatarUrl || auth.user?.avatarUrl,
          }
        : defaultProfile;
      if (isEffectiveAuthenticated) {
        await profileRepository.save(resolvedProfile);
      }
      profileRef.current = resolvedProfile;
      setProfile(resolvedProfile);
      broadcastProfile({
        displayName: resolvedProfile.displayName,
        avatarEmoji: resolvedProfile.avatarEmoji,
        dailyGoalMinutes: resolvedProfile.dailyGoalMinutes,
      });

      if (!options?.skipTelemetry && resolvedProfile.dailyGoalMinutes !== previousGoalMinutes) {
        void telemetryTracker.onDailyGoalChanged({
          previousGoalMinutes,
          newGoalMinutes: resolvedProfile.dailyGoalMinutes,
        });
      }

      if (isConvexConfigured && isEffectiveAuthenticated) {
        const patchPayload = {
          displayName: resolvedProfile.displayName,
          avatarEmoji: resolvedProfile.avatarEmoji,
          dailyGoalMinutes: resolvedProfile.dailyGoalMinutes,
        };
        const ownerId = getActiveOwnerUserId();
        const queuedOp = ownerId
          ? enqueueOutboxOperation(ownerId, { kind: 'update_profile', payload: patchPayload })
          : null;

        if (isConvexAuthReady && isConvexConnectedRef.current) {
          pendingProfileMutationsRef.current += 1;
          convexMutations
            .updateProfile(patchPayload)
            .then(() => {
              if (queuedOp) removeOutboxOperation(queuedOp.id);
            })
            .catch(console.warn)
            .finally(() => {
              pendingProfileMutationsRef.current = Math.max(
                0,
                pendingProfileMutationsRef.current - 1
              );
              lastLocalProfileEditMsRef.current = Date.now();
            });
        }
      }
      return resolvedProfile;
    },
    [
      isConvexConfigured,
      isEffectiveAuthenticated,
      isConvexAuthReady,
      auth.user?.id,
      auth.user?.email,
      auth.user?.avatarUrl,
      convexMutations,
      getActiveOwnerUserId,
    ]
  );

  const updateSettings = useCallback(
    async (
      newValues: Partial<UserSettings>,
      options?: TelemetryControlOptions
    ): Promise<void> => {
      lastLocalSettingsEditMsRef.current = Date.now();
      const latestStored = settingsRepository.getSync();
      const previousSettings = { ...latestStored, ...settingsRef.current };
      const localValues = pickLocalSettings(newValues);
      const definedLocalValues = Object.fromEntries(
        Object.entries(localValues).filter(([, v]) => v !== undefined)
      ) as Partial<UserSettings>;
      const merged = { ...previousSettings, ...definedLocalValues };
      settingsRef.current = merged;
      setSettings(merged);
      await settingsRepository.save(merged);
      broadcastSettings(definedLocalValues);

      if (!options?.skipTelemetry) {
        void telemetryTracker.onSettingsChanged({
          previousSettings,
          newSettings: merged,
        });
      }

      if (!isEffectiveAuthenticated) {
        markGuestDataModified();
        return;
      }

      const convexValues = pickConvexSettings(newValues);
      const cleanConvexPatch = Object.fromEntries(
        Object.entries(convexValues).filter(([, v]) => v !== undefined)
      );
      if (isConvexConfigured && Object.keys(cleanConvexPatch).length > 0) {
        const ownerId = getActiveOwnerUserId();
        const queuedOp = ownerId
          ? enqueueOutboxOperation(ownerId, {
              kind: 'update_settings',
              payload: cleanConvexPatch,
            })
          : null;

        if (!isConvexAuthReady || !isConvexConnectedRef.current) {
          return;
        }

        pendingSettingsMutationsRef.current += 1;
        convexMutations
          .updateSettings(cleanConvexPatch)
          .then(() => {
            if (queuedOp) {
              removeOutboxOperation(queuedOp.id);
            }
          })
          .catch((err) => {
            console.warn('Convex updateSettings failed (kept in offline outbox):', err);
          })
          .finally(() => {
            pendingSettingsMutationsRef.current = Math.max(
              0,
              pendingSettingsMutationsRef.current - 1
            );
            lastLocalSettingsEditMsRef.current = Date.now();
          });
      }
    },
    [
      isConvexConfigured,
      isEffectiveAuthenticated,
      isConvexAuthReady,
      convexMutations,
      getActiveOwnerUserId,
    ]
  );

  const resetSettingsToDefaults = useCallback(
    async (options?: TelemetryControlOptions): Promise<UserSettings> => {
      lastLocalSettingsEditMsRef.current = Date.now();
      const previousSettings = settingsRef.current;
      const defaultSettings = await settingsRepository.resetToDefaults();
      settingsRef.current = defaultSettings;
      setSettings(defaultSettings);
      broadcastSettings(defaultSettings);

      if (!options?.skipTelemetry) {
        void telemetryTracker.onSettingsChanged({
          previousSettings,
          newSettings: defaultSettings,
        });
      }

      if (isConvexConfigured && isConvexAuthReady && isConvexConnectedRef.current && !auth.isTokenExpired) {
        void notificationService.unsubscribePush(() =>
          convexMutations.unregisterPushSubscription({ deviceId: DEVICE_ID })
        );
      } else {
        void notificationService.unsubscribePush();
      }

      if (isConvexConfigured && isEffectiveAuthenticated) {
        const patchPayload = pickConvexSettings(defaultSettings);
        const ownerId = getActiveOwnerUserId();
        const queuedOp = ownerId
          ? enqueueOutboxOperation(ownerId, { kind: 'update_settings', payload: patchPayload })
          : null;

        if (isConvexAuthReady && isConvexConnectedRef.current) {
          pendingSettingsMutationsRef.current += 1;
          convexMutations
            .updateSettings(patchPayload)
            .then(() => {
              if (queuedOp) removeOutboxOperation(queuedOp.id);
            })
            .catch(console.warn)
            .finally(() => {
              pendingSettingsMutationsRef.current = Math.max(
                0,
                pendingSettingsMutationsRef.current - 1
              );
              lastLocalSettingsEditMsRef.current = Date.now();
            });
        }
      }
      return defaultSettings;
    },
    [
      isConvexConfigured,
      isEffectiveAuthenticated,
      isConvexAuthReady,
      auth.isTokenExpired,
      convexMutations,
      getActiveOwnerUserId,
    ]
  );

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
      registerFullSyncHandler,
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
      registerFullSyncHandler,
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

  return <AuthProfileContext.Provider value={value}>{children}</AuthProfileContext.Provider>;
};

export const useAuthProfile = (): AuthProfileContextValue => {
  const context = useContext(AuthProfileContext);
  if (!context) {
    throw new Error('useAuthProfile must be used within an AuthProfileProvider');
  }
  return context;
};
