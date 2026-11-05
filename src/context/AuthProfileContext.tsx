import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useConvexAuth, useAuthActions } from '@convex-dev/auth/react';
import { UserSettings, DEFAULT_SETTINGS } from '../types/settings';
import { UserProfile, DEFAULT_PROFILE, AuthState } from '../types/user';
import { parseGoogleJwt, buildProfileFromJwt } from '../services/auth/AuthService';
import { SoundService } from '../services/audio/SoundService';
import { NotificationService } from '../services/notification/NotificationService';
import { useConvexSync } from '../services/convex/useConvexSync';
import {
  authService,
  profileRepository,
  settingsRepository,
  soundService,
  notificationService,
} from './services';

export interface AuthProfileContextValue {
  auth: AuthState;
  isEffectiveAuthenticated: boolean;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
  syncWithCloud: (force?: boolean) => Promise<void>;
  profile: UserProfile;
  updateProfile: (newProfile: Partial<UserProfile>) => Promise<void>;
  resetProfileToDefaults: () => Promise<UserProfile>;
  settings: UserSettings;
  updateSettings: (newSettings: Partial<UserSettings>) => Promise<void>;
  resetSettingsToDefaults: () => Promise<UserSettings>;
  sound: SoundService;
  notifications: NotificationService;
  convexSync: ReturnType<typeof useConvexSync>;
}

const AuthProfileContext = createContext<AuthProfileContextValue | null>(null);

export const AuthProfileProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [auth, setAuth] = useState<AuthState>(() => authService.getInitialAuthState());

  const settingsRef = useRef<UserSettings>(settings);
  settingsRef.current = settings;

  const profileRef = useRef<UserProfile>(profile);
  profileRef.current = profile;

  const lastLocalSettingsEditMsRef = useRef<number>(0);
  const lastLocalProfileEditMsRef = useRef<number>(0);
  const tokenRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { isAuthenticated: isConvexAuthAuthenticated } = useConvexAuth();
  const { signIn: convexSignIn, signOut: convexSignOut } = useAuthActions();

  const isEffectiveAuthenticated = isConvexAuthAuthenticated || auth.isAuthenticated;

  const convexSync = useConvexSync(isEffectiveAuthenticated);
  const { isConvexConfigured, convexUser, setAuthToken, mutations: convexMutations } = convexSync;

  const scheduleTokenRefresh = useCallback((expSeconds?: number) => {
    if (tokenRefreshTimerRef.current) {
      clearTimeout(tokenRefreshTimerRef.current);
      tokenRefreshTimerRef.current = null;
    }
    if (!expSeconds) return;

    const msUntilExpiry = expSeconds * 1000 - Date.now();
    const refreshInMs = Math.max(10000, msUntilExpiry - 5 * 60 * 1000);

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
    authService.logout();
    notificationService.setAuthToken(null);
    if (isConvexConfigured) {
      try {
        await convexSignOut();
      } catch (err) {
        console.warn('Convex signOut error', err);
      }
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
  }, [isConvexConfigured, convexSignOut, setAuthToken]);

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
          try {
            await convexSignIn('google-id-token', { token: idToken });
          } catch (convexErr) {
            console.warn('Convex sign-in error:', convexErr);
          }
        }

        notificationService.setAuthToken(idToken);
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
    [isConvexConfigured, convexSignIn, scheduleTokenRefresh]
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
          if (storedToken) {
            notificationService.setAuthToken(storedToken);
            setAuthToken(storedToken);
          }
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
        await logout();
      }
    }

    init();
  }, [isConvexConfigured, setAuthToken, scheduleTokenRefresh, logout]);

  // Reactive adoption of Convex user profile & settings
  useEffect(() => {
    if (!isEffectiveAuthenticated || !convexUser) return;

    if (
      convexUser.settings &&
      Date.now() - lastLocalSettingsEditMsRef.current >= 2000
    ) {
      const s = convexUser.settings;
      const cur = settingsRef.current;
      const settingsChanged =
        cur.workDurationMinutes !== s.workDurationMinutes ||
        cur.shortBreakDurationMinutes !== s.shortBreakDurationMinutes ||
        cur.longBreakDurationMinutes !== s.longBreakDurationMinutes ||
        cur.longBreakInterval !== s.longBreakInterval ||
        cur.autoStartBreaks !== s.autoStartBreaks ||
        cur.autoStartPomodoros !== s.autoStartPomodoros ||
        cur.soundVolume !== s.soundVolume ||
        cur.soundEnabled !== s.soundEnabled ||
        cur.notificationsEnabled !== s.notificationsEnabled;

      if (settingsChanged) {
        settingsRef.current = s;
        setSettings(s);
        settingsRepository.save(s);
      }
    }

    if (Date.now() - lastLocalProfileEditMsRef.current >= 2000) {
      const curProf = profileRef.current;
      const updatedProfile: UserProfile = {
        ...curProf,
        id: convexUser.id,
        email: convexUser.email,
        displayName: convexUser.displayName,
        avatarUrl: convexUser.avatarUrl,
        avatarEmoji: convexUser.avatarEmoji,
        dailyGoalMinutes: convexUser.dailyGoalMinutes,
      };
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
  }, [convexUser, isEffectiveAuthenticated]);

  // Google Identity Services auto-selection & silent token refresh
  useEffect(() => {
    const initGoogleAccounts = () => {
      if (typeof window === 'undefined' || !(window as any).google?.accounts?.id) return;
      try {
        (window as any).google.accounts.id.initialize({
          client_id:
            import.meta.env.VITE_GOOGLE_CLIENT_ID ||
            '229654613287-8utvd3fhrcsalh1ol02ev2mlg140kbai.apps.googleusercontent.com',
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
    async (_force = false): Promise<void> => {
      if (isEffectiveAuthenticated) {
        setAuth((prev) => ({ ...prev, isSyncing: true, syncError: null }));
        setTimeout(() => {
          setAuth((prev) => ({
            ...prev,
            isSyncing: false,
            lastSyncedAt: new Date().toISOString(),
          }));
        }, 300);
      }
    },
    [isEffectiveAuthenticated]
  );

  const updateProfile = useCallback(
    async (newProfile: Partial<UserProfile>): Promise<void> => {
      lastLocalProfileEditMsRef.current = Date.now();
      const merged = { ...profileRef.current, ...newProfile };
      profileRef.current = merged;
      setProfile(merged);
      await profileRepository.save(merged);

      if (isConvexConfigured && isEffectiveAuthenticated) {
        convexMutations
          .updateProfile({
            displayName: newProfile.displayName,
            avatarEmoji: newProfile.avatarEmoji,
            dailyGoalMinutes: newProfile.dailyGoalMinutes,
          })
          .catch(console.warn);
      }
    },
    [isConvexConfigured, isEffectiveAuthenticated, convexMutations]
  );

  const resetProfileToDefaults = useCallback(async (): Promise<UserProfile> => {
    const defaultProfile = await profileRepository.resetToDefaults();
    profileRef.current = defaultProfile;
    setProfile(defaultProfile);
    if (isConvexConfigured && isEffectiveAuthenticated) {
      convexMutations.updateProfile(defaultProfile).catch(console.warn);
    }
    return defaultProfile;
  }, [isConvexConfigured, isEffectiveAuthenticated, convexMutations]);

  const updateSettings = useCallback(
    async (newValues: Partial<UserSettings>): Promise<void> => {
      lastLocalSettingsEditMsRef.current = Date.now();
      const merged = { ...settingsRef.current, ...newValues };
      settingsRef.current = merged;
      setSettings(merged);
      await settingsRepository.save(merged);

      if (isConvexConfigured && isEffectiveAuthenticated) {
        convexMutations.updateSettings(newValues).catch(console.warn);
      }
    },
    [isConvexConfigured, isEffectiveAuthenticated, convexMutations]
  );

  const resetSettingsToDefaults = useCallback(async (): Promise<UserSettings> => {
    const defaultSettings = await settingsRepository.resetToDefaults();
    settingsRef.current = defaultSettings;
    setSettings(defaultSettings);
    if (isConvexConfigured && isEffectiveAuthenticated) {
      convexMutations.updateSettings(defaultSettings).catch(console.warn);
    }
    return defaultSettings;
  }, [isConvexConfigured, isEffectiveAuthenticated, convexMutations]);

  const value = useMemo<AuthProfileContextValue>(
    () => ({
      auth,
      isEffectiveAuthenticated,
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
    }),
    [
      auth,
      isEffectiveAuthenticated,
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
