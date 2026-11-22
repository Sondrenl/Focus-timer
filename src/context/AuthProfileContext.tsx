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
import { SoundService } from '../services/audio/SoundService';
import {
  NotificationService,
  PushSubscriptionStatus,
} from '../services/notification/NotificationService';
import { subscribeReset } from '../services/timer/TimerBroadcast';
import { useConvexSync } from '../services/convex/useConvexSync';
import { usePushSubscriptionSync } from '../hooks/usePushSubscriptionSync';
import { DEVICE_ID } from './timer/timerPersistence';
import { sanitizeProfile } from '../services/repository/ProfileRepository';
import {
  authService,
  profileRepository,
  settingsRepository,
  soundService,
  notificationService,
  telemetryTracker,
} from './services';

function pickConvexSettings(s: Partial<UserSettings>) {
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

export interface TelemetryControlOptions {
  skipTelemetry?: boolean;
}

export interface AuthProfileContextValue {
  auth: AuthState;
  isEffectiveAuthenticated: boolean;
  isConvexAuthAuthenticated: boolean;
  isConvexAuthLoading: boolean;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
  syncWithCloud: () => Promise<void>;
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
  const [auth, setAuth] = useState<AuthState>(() => authService.getInitialAuthState());

  const settingsRef = useRef<UserSettings>(settings);
  settingsRef.current = settings;

  const profileRef = useRef<UserProfile>(profile);
  profileRef.current = profile;

  const lastLocalSettingsEditMsRef = useRef<number>(0);
  const lastLocalProfileEditMsRef = useRef<number>(0);
  const pendingSettingsMutationsRef = useRef<number>(0);
  const pendingProfileMutationsRef = useRef<number>(0);
  const lastPersistedAuthUserJsonRef = useRef<string | null>(null);
  const tokenRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { isAuthenticated: isConvexAuthAuthenticated, isLoading: isConvexAuthLoading } = useConvexAuth();
  const { signIn: convexSignIn, signOut: convexSignOut } = useAuthActions();

  const isEffectiveAuthenticated = isConvexAuthAuthenticated || auth.isAuthenticated;

  const convexSync = useConvexSync(isEffectiveAuthenticated);
  const {
    isConvexConfigured,
    convexUser,
    vapidPublicKey,
    devicePushStatus,
    setAuthToken,
    mutations: convexMutations,
  } = convexSync;

  const convexUserRef = useRef(convexUser);
  convexUserRef.current = convexUser;

  useEffect(() => {
    return () => {
      if (tokenRefreshTimerRef.current) {
        clearTimeout(tokenRefreshTimerRef.current);
        tokenRefreshTimerRef.current = null;
      }
    };
  }, []);

  const scheduleTokenRefresh = useCallback((expSeconds?: number) => {
    if (tokenRefreshTimerRef.current) {
      clearTimeout(tokenRefreshTimerRef.current);
      tokenRefreshTimerRef.current = null;
    }
    if (!expSeconds) return;

    const msUntilExpiry = expSeconds * 1000 - Date.now();
    const refreshInMs = Math.min(2_147_483_647, Math.max(10_000, msUntilExpiry - 5 * 60 * 1000));

    tokenRefreshTimerRef.current = setTimeout(() => {
      if (typeof window !== 'undefined' && (window as any).google?.accounts?.id) {
        try {
          (window as any).google.accounts.id.prompt((notification: any) => {
            if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
              if (!authService.hasConvexAuthSession()) {
                setAuth((prev) => ({ ...prev, isTokenExpired: true }));
              }
            }
          });
        } catch {
          if (!authService.hasConvexAuthSession()) {
            setAuth((prev) => ({ ...prev, isTokenExpired: true }));
          }
        }
      } else if (!authService.hasConvexAuthSession()) {
        setAuth((prev) => ({ ...prev, isTokenExpired: true }));
      }
    }, refreshInMs);
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    if (tokenRefreshTimerRef.current) {
      clearTimeout(tokenRefreshTimerRef.current);
      tokenRefreshTimerRef.current = null;
    }
    if (isConvexConfigured && isEffectiveAuthenticated && !auth.isTokenExpired) {
      await notificationService.unsubscribePush(() =>
        convexMutations.unregisterPushSubscription({ deviceId: DEVICE_ID })
      );
    } else {
      await notificationService.unsubscribePush();
    }
    const hadConvexSession = authService.hasConvexAuthSession();
    if (isConvexConfigured) {
      try {
        await convexSignOut();
      } catch (err) {
        console.warn('Convex signOut error', err);
      }
    }
    authService.logout();
    lastPersistedAuthUserJsonRef.current = null;
    lastLocalSettingsEditMsRef.current = 0;
    lastLocalProfileEditMsRef.current = 0;
    pendingSettingsMutationsRef.current = 0;
    pendingProfileMutationsRef.current = 0;
    if (isConvexConfigured && !hadConvexSession) {
      setAuthToken(null);
    }
    setAuth({
      isAuthenticated: false,
      user: null,
      token: null,
      isSyncing: false,
      lastSyncedAt: null,
      syncError: null,
      isTokenExpired: false,
    });
    const cleanedProfile: UserProfile = {
      ...DEFAULT_PROFILE,
      dailyGoalMinutes: profileRef.current.dailyGoalMinutes || DEFAULT_PROFILE.dailyGoalMinutes,
      createdAt: profileRef.current.createdAt || new Date().toISOString(),
    };
    profileRef.current = cleanedProfile;
    await profileRepository.save(cleanedProfile);
    setProfile(cleanedProfile);
  }, [
    isConvexConfigured,
    isEffectiveAuthenticated,
    auth.isTokenExpired,
    convexSignOut,
    setAuthToken,
    convexMutations,
  ]);

  const loginWithGoogle = useCallback(
    async (idToken: string): Promise<void> => {
      setAuth((prev) => ({ ...prev, isSyncing: true, syncError: null }));
      try {
        const payload = parseGoogleJwt(idToken);
        if (!payload || !payload.sub) {
          throw new Error('Invalid Google identity token');
        }

        const user = buildProfileFromJwt(payload, profileRef.current);
        authService.saveAuthSession(idToken, user);

        if (isConvexConfigured) {
          let convexSignedIn = false;
          try {
            const res = await convexSignIn('google-id-token', { token: idToken });
            convexSignedIn = Boolean(res?.signingIn) || authService.hasConvexAuthSession();
          } catch (convexErr) {
            console.warn('Convex sign-in error:', convexErr);
          }
          if (!convexSignedIn && !authService.hasConvexAuthSession()) {
            setAuthToken(idToken);
          }
        }

        setAuth({
          isAuthenticated: true,
          user,
          token: idToken,
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
          avatarEmoji: '',
          displayName: user.displayName || profileRef.current.displayName,
        };
        profileRef.current = updatedProfile;
        await profileRepository.save(updatedProfile);
        setProfile(updatedProfile);

        if (payload.exp && !authService.hasConvexAuthSession()) {
          scheduleTokenRefresh(payload.exp);
        }
      } catch (err) {
        setAuth((prev) => ({
          ...prev,
          isSyncing: false,
          syncError: (err as Error).message || 'Google sign-in failed',
        }));
        throw err;
      }
    },
    [isConvexConfigured, convexSignIn, setAuthToken, scheduleTokenRefresh]
  );

  // Initial local load & auth verification
  useEffect(() => {
    async function init() {
      const [loadedProfile, loadedSettings] = await Promise.all([
        profileRepository.get(),
        settingsRepository.get(),
      ]);

      profileRef.current = loadedProfile;
      settingsRef.current = loadedSettings;
      setProfile(loadedProfile);
      setSettings(loadedSettings);

      const storedToken = authService.getStoredToken();
      const storedUser = authService.getStoredUser();
      const hasConvexSession = authService.hasConvexAuthSession();

      if ((storedToken || hasConvexSession) && isConvexConfigured) {
        const payload = storedToken ? parseGoogleJwt(storedToken) : null;
        const isExpired = !hasConvexSession && authService.isTokenExpired(storedToken);
        const verifiedUser =
          payload && payload.sub
            ? buildProfileFromJwt(payload, storedUser || profileRef.current)
            : storedUser || profileRef.current;

        if (!isExpired) {
          setAuth({
            isAuthenticated: true,
            user: verifiedUser,
            token: storedToken,
            isSyncing: false,
            lastSyncedAt: null,
            syncError: null,
            isTokenExpired: false,
          });
          if (payload?.exp && !hasConvexSession) {
            scheduleTokenRefresh(payload.exp);
          }
        } else {
          setAuth({
            isAuthenticated: false,
            user: verifiedUser,
            token: null,
            isSyncing: false,
            lastSyncedAt: null,
            syncError: null,
            isTokenExpired: true,
          });
        }
      } else if (!storedToken && !storedUser && !hasConvexSession) {
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

    init();
  }, [isConvexConfigured, scheduleTokenRefresh]);

  // Restore legacy Google JWT auth only after Convex Auth finishes loading without a persistent session
  useEffect(() => {
    if (!isConvexConfigured || isConvexAuthLoading || isConvexAuthAuthenticated) {
      return;
    }
    if (authService.hasConvexAuthSession()) {
      return;
    }
    const storedToken = authService.getStoredToken();
    if (storedToken && !authService.isTokenExpired(storedToken)) {
      setAuthToken(storedToken);
    }
  }, [isConvexConfigured, isConvexAuthLoading, isConvexAuthAuthenticated, setAuthToken]);

  // Clear stale local auth state if a persisted Convex Auth session expired/failed to refresh
  // and no valid legacy Google JWT exists.
  useEffect(() => {
    if (
      !isConvexConfigured ||
      isConvexAuthLoading ||
      isConvexAuthAuthenticated ||
      !auth.isAuthenticated
    ) {
      return;
    }
    if (authService.hasConvexAuthSession()) {
      return;
    }
    const storedToken = authService.getStoredToken();
    if (storedToken && !authService.isTokenExpired(storedToken)) {
      return;
    }
    setAuth((prev) =>
      prev.isAuthenticated
        ? {
            ...prev,
            isAuthenticated: false,
            token: null,
            isTokenExpired: Boolean(storedToken),
          }
        : prev
    );
  }, [isConvexConfigured, isConvexAuthLoading, isConvexAuthAuthenticated, auth.isAuthenticated]);

  // Multi-tab factory-reset listener for profile & settings
  useEffect(() => {
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
    return () => {
      unsubReset();
    };
  }, []);

  // Reactive adoption of Convex user profile & settings
  useEffect(() => {
    if (!isEffectiveAuthenticated || !convexUser) return;

    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const applyRemoteUser = () => {
      if (cancelled) return;
      const now = Date.now();
      if (
        convexUser.settings &&
        pendingSettingsMutationsRef.current === 0 &&
        now - lastLocalSettingsEditMsRef.current >= 2000
      ) {
        const cur = settingsRef.current;
        const s: UserSettings = {
          ...convexUser.settings,
          // Notifications are per-device (Decision 4A); never let remote account settings overwrite this device's toggle
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
          settingsRepository.save(s);
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
          displayName: convexUser.displayName,
          avatarUrl: convexUser.avatarUrl,
          avatarEmoji: convexUser.avatarEmoji,
          dailyGoalMinutes: convexUser.dailyGoalMinutes,
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
          profileRepository.save(updatedProfile);
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

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };
  }, [convexUser, isEffectiveAuthenticated]);

  // Google Identity Services auto-selection & silent token refresh
  useEffect(() => {
    const initGoogleAccounts = () => {
      if (typeof window === 'undefined' || !(window as any).google?.accounts?.id) return;
      try {
        (window as any).google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          auto_select: true,
          callback: async (response: any) => {
            if (response.credential) {
              await loginWithGoogle(response.credential);
            }
          },
        });
      } catch {
        // Ignore initialization error
      }
    };

    initGoogleAccounts();
    const interval = setInterval(() => {
      if ((window as any).google?.accounts?.id) {
        initGoogleAccounts();
        clearInterval(interval);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [loginWithGoogle]);

  // Prompt Google One Tap if token expired and no persistent session exists
  useEffect(() => {
    if (
      auth.isTokenExpired &&
      !authService.hasConvexAuthSession() &&
      typeof window !== 'undefined' &&
      (window as any).google?.accounts?.id
    ) {
      try {
        (window as any).google.accounts.id.prompt();
      } catch {
        // Ignore prompt error
      }
    }
  }, [auth.isTokenExpired]);

  const syncWithCloud = useCallback(
    async (): Promise<void> => {
      if (!isEffectiveAuthenticated) return;
      if (isConvexConfigured && convexUserRef.current === undefined) return;
      setAuth((prev) => ({ ...prev, isSyncing: true, syncError: null }));
      try {
        if (isConvexConfigured) {
          const curProfile = sanitizeProfile(profileRef.current);
          const curSettings = settingsRef.current;
          pendingProfileMutationsRef.current += 1;
          pendingSettingsMutationsRef.current += 1;
          try {
            await Promise.all([
              convexMutations.updateProfile({
                displayName: curProfile.displayName,
                avatarEmoji: curProfile.avatarEmoji,
                dailyGoalMinutes: curProfile.dailyGoalMinutes,
              }),
              convexMutations.updateSettings(pickConvexSettings(curSettings)),
            ]);
          } finally {
            pendingProfileMutationsRef.current = Math.max(
              0,
              pendingProfileMutationsRef.current - 1
            );
            pendingSettingsMutationsRef.current = Math.max(
              0,
              pendingSettingsMutationsRef.current - 1
            );
            const completedAt = Date.now();
            lastLocalProfileEditMsRef.current = completedAt;
            lastLocalSettingsEditMsRef.current = completedAt;
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
    },
    [isConvexConfigured, isEffectiveAuthenticated, convexMutations]
  );

  const updateProfile = useCallback(
    async (
      newProfile: Partial<UserProfile>,
      options?: TelemetryControlOptions
    ): Promise<void> => {
      lastLocalProfileEditMsRef.current = Date.now();
      const previousGoalMinutes = profileRef.current.dailyGoalMinutes;
      const merged = sanitizeProfile({ ...profileRef.current, ...newProfile });
      profileRef.current = merged;
      setProfile(merged);
      await profileRepository.save(merged);

      if (!options?.skipTelemetry && merged.dailyGoalMinutes !== previousGoalMinutes) {
        void telemetryTracker.onDailyGoalChanged({
          previousGoalMinutes,
          newGoalMinutes: merged.dailyGoalMinutes,
        });
      }

      if (isConvexConfigured && isEffectiveAuthenticated) {
        pendingProfileMutationsRef.current += 1;
        convexMutations
          .updateProfile({
            ...(newProfile.displayName !== undefined ? { displayName: merged.displayName } : {}),
            ...(newProfile.avatarEmoji !== undefined ? { avatarEmoji: merged.avatarEmoji } : {}),
            ...(newProfile.dailyGoalMinutes !== undefined
              ? { dailyGoalMinutes: merged.dailyGoalMinutes }
              : {}),
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
    },
    [isConvexConfigured, isEffectiveAuthenticated, convexMutations]
  );

  const resetProfileToDefaults = useCallback(
    async (options?: TelemetryControlOptions): Promise<UserProfile> => {
      lastLocalProfileEditMsRef.current = Date.now();
      const previousGoalMinutes = profileRef.current.dailyGoalMinutes;
      const defaultProfile = await profileRepository.resetToDefaults();
      profileRef.current = defaultProfile;
      setProfile(defaultProfile);
      if (!options?.skipTelemetry && defaultProfile.dailyGoalMinutes !== previousGoalMinutes) {
        void telemetryTracker.onDailyGoalChanged({
          previousGoalMinutes,
          newGoalMinutes: defaultProfile.dailyGoalMinutes,
        });
      }
      if (isConvexConfigured && isEffectiveAuthenticated) {
        pendingProfileMutationsRef.current += 1;
        convexMutations
          .updateProfile({
            displayName: defaultProfile.displayName,
            avatarEmoji: defaultProfile.avatarEmoji,
            dailyGoalMinutes: defaultProfile.dailyGoalMinutes,
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
      return defaultProfile;
    },
    [isConvexConfigured, isEffectiveAuthenticated, convexMutations]
  );

  const updateSettings = useCallback(
    async (
      newValues: Partial<UserSettings>,
      options?: TelemetryControlOptions
    ): Promise<void> => {
      lastLocalSettingsEditMsRef.current = Date.now();
      const previousSettings = settingsRef.current;
      const localValues = pickLocalSettings(newValues);
      const definedLocalValues = Object.fromEntries(
        Object.entries(localValues).filter(([_, v]) => v !== undefined)
      ) as Partial<UserSettings>;
      const merged = { ...settingsRef.current, ...definedLocalValues };
      settingsRef.current = merged;
      setSettings(merged);
      await settingsRepository.save(merged);

      if (!options?.skipTelemetry) {
        void telemetryTracker.onSettingsChanged({
          previousSettings,
          newSettings: merged,
        });
      }

      const convexValues = pickConvexSettings(newValues);
      const hasConvexChanges = Object.values(convexValues).some((v) => v !== undefined);
      if (isConvexConfigured && isEffectiveAuthenticated && hasConvexChanges) {
        pendingSettingsMutationsRef.current += 1;
        convexMutations
          .updateSettings(convexValues)
          .catch(console.warn)
          .finally(() => {
            pendingSettingsMutationsRef.current = Math.max(
              0,
              pendingSettingsMutationsRef.current - 1
            );
            lastLocalSettingsEditMsRef.current = Date.now();
          });
      }
    },
    [isConvexConfigured, isEffectiveAuthenticated, convexMutations]
  );

  const resetSettingsToDefaults = useCallback(
    async (options?: TelemetryControlOptions): Promise<UserSettings> => {
      lastLocalSettingsEditMsRef.current = Date.now();
      const previousSettings = settingsRef.current;
      const defaultSettings = await settingsRepository.resetToDefaults();
      settingsRef.current = defaultSettings;
      setSettings(defaultSettings);

      if (!options?.skipTelemetry) {
        void telemetryTracker.onSettingsChanged({
          previousSettings,
          newSettings: defaultSettings,
        });
      }

      if (isConvexConfigured && isEffectiveAuthenticated && !auth.isTokenExpired) {
        void notificationService.unsubscribePush(() =>
          convexMutations.unregisterPushSubscription({ deviceId: DEVICE_ID })
        );
      } else {
        void notificationService.unsubscribePush();
      }

      if (isConvexConfigured && isEffectiveAuthenticated) {
        pendingSettingsMutationsRef.current += 1;
        convexMutations
          .updateSettings(pickConvexSettings(defaultSettings))
          .catch(console.warn)
          .finally(() => {
            pendingSettingsMutationsRef.current = Math.max(
              0,
              pendingSettingsMutationsRef.current - 1
            );
            lastLocalSettingsEditMsRef.current = Date.now();
          });
      }
      return defaultSettings;
    },
    [isConvexConfigured, isEffectiveAuthenticated, auth.isTokenExpired, convexMutations]
  );

  const { pushStatus, syncPushSubscription } = usePushSubscriptionSync({
    notificationService,
    isConvexConfigured,
    isEffectiveAuthenticated,
    notificationsEnabled: settings.notificationsEnabled,
    settingsRef,
    vapidPublicKey,
    isServerSubscriptionRegistered: devicePushStatus?.registered,
    registerPushSubscription: convexMutations.registerPushSubscription,
  });

  const value = useMemo<AuthProfileContextValue>(
    () => ({
      auth,
      isEffectiveAuthenticated,
      isConvexAuthAuthenticated,
      isConvexAuthLoading,
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
      isConvexAuthAuthenticated,
      isConvexAuthLoading,
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

  return <AuthProfileContext.Provider value={value}>{children}</AuthProfileContext.Provider>;
};

export const useAuthProfile = (): AuthProfileContextValue => {
  const context = useContext(AuthProfileContext);
  if (!context) {
    throw new Error('useAuthProfile must be used within an AuthProfileProvider');
  }
  return context;
};
