import { UserProfile, AuthState } from '../../types/user';
import { RemoteTimerState, PeerPresence } from '../../types/timer';
import { GoogleJwtPayload } from '../../types/auth';
import { isMobileDevice } from '../../utils/environment';

export type { RemoteTimerState, PeerPresence, GoogleJwtPayload };
export { isMobileDevice };

const TOKEN_KEY = 'focus_timer_auth_token';
const USER_KEY = 'focus_timer_user_profile';
const LAST_SYNC_KEY = 'focus_timer_last_synced_at';

/**
 * Decodes and parses a standard Google identity JWT.
 */
export function parseGoogleJwt(token: string): GoogleJwtPayload | null {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload) as GoogleJwtPayload;
  } catch {
    return null;
  }
}

/**
 * Builds a consistent UserProfile from a parsed Google JWT,
 * preserving any custom avatarEmoji or existing preferences.
 */
export function buildProfileFromJwt(
  payload: GoogleJwtPayload,
  currentProfile?: Partial<UserProfile>
): UserProfile {
  return {
    id: payload.sub,
    email: payload.email || '',
    displayName:
      payload.name ||
      payload.email?.split('@')[0] ||
      currentProfile?.displayName ||
      'Focus Practitioner',
    avatarUrl: payload.picture,
    avatarEmoji: currentProfile?.avatarEmoji || '',
    dailyGoalMinutes: currentProfile?.dailyGoalMinutes || 120,
    createdAt: currentProfile?.createdAt || new Date().toISOString(),
  };
}

/**
 * Lightweight authentication and local session service for Convex-backed Focus Timer.
 * All remote state and synchronization are handled reactively by Convex.
 */
export class AuthService {
  private static instance: AuthService;

  private constructor() {}

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  public getServerNow(): number {
    return Date.now();
  }

  public getStoredToken(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  public getStoredUser(): UserProfile | null {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  public getLastSyncedAt(): string | null {
    try {
      return localStorage.getItem(LAST_SYNC_KEY);
    } catch {
      return null;
    }
  }

  public saveAuthSession(token: string, user: UserProfile): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch (e) {
      console.warn('Could not persist auth to localStorage', e);
    }
  }

  public getInitialAuthState(): AuthState {
    const token = this.getStoredToken();
    const user = this.getStoredUser();
    return {
      isAuthenticated: Boolean(token && user),
      user: user,
      token: token,
      isSyncing: false,
      lastSyncedAt: this.getLastSyncedAt(),
      syncError: null,
    };
  }

  public logout(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(LAST_SYNC_KEY);
    } catch (e) {
      console.warn('Error clearing auth from localStorage', e);
    }
  }
}
