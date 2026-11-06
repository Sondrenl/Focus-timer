import { UserProfile, AuthState } from '../../types/user';
import { RemoteTimerState, PeerPresence } from '../../types/timer';
import { GoogleJwtPayload } from '../../types/auth';
import { isMobileDevice } from '../../utils/environment';

export type { RemoteTimerState, PeerPresence, GoogleJwtPayload };
export { isMobileDevice };

export const AUTH_TOKEN_KEY = 'auth_token_v2';
export const AUTH_USER_KEY = 'auth_user_v2';
const TOKEN_KEY = AUTH_TOKEN_KEY;
const USER_KEY = AUTH_USER_KEY;
const LAST_SYNC_KEY = 'auth_last_synced_at_v1';

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

export function buildProfileFromJwt(
  payload: GoogleJwtPayload,
  currentProfile: UserProfile
): UserProfile {
  const safeName = typeof payload.name === 'string' && payload.name.trim()
    ? payload.name.trim().slice(0, 50)
    : currentProfile.displayName;
  const safeAvatarUrl = typeof payload.picture === 'string' && payload.picture.startsWith('https://')
    ? payload.picture
    : currentProfile.avatarUrl;

  return {
    ...currentProfile,
    id: payload.sub || currentProfile.id,
    email: payload.email || currentProfile.email,
    displayName: safeName,
    avatarUrl: safeAvatarUrl,
    avatarEmoji: '', // Clear emoji when Google picture exists
  };
}

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
      return (
        localStorage.getItem(TOKEN_KEY) ||
        localStorage.getItem('auth_token_v1')
      );
    } catch {
      return null;
    }
  }

  public getStoredUser(): UserProfile | null {
    try {
      const data =
        localStorage.getItem(USER_KEY) ||
        localStorage.getItem('auth_user_v1');
      return data ? JSON.parse(data) : null;
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

  public isTokenExpired(token?: string | null): boolean {
    if (!token) return true;
    const payload = parseGoogleJwt(token);
    if (!payload || !payload.exp) return false;
    // Buffer by 30 seconds
    return Date.now() >= (payload.exp * 1000 - 30000);
  }

  public hasConvexAuthSession(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('__convexAuthRefreshToken') || key.startsWith('__convexAuthJWT'))) {
          const val = localStorage.getItem(key);
          if (val && val !== 'null' && val !== '""') {
            return true;
          }
        }
      }
    } catch {
      // Ignore
    }
    return false;
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
    const hasConvexSession = this.hasConvexAuthSession();
    const isExpired = !hasConvexSession && this.isTokenExpired(token);
    const isAuthenticated = Boolean(user && (hasConvexSession || (token && !isExpired)));
    return {
      isAuthenticated,
      user,
      token: isAuthenticated ? token : null,
      isSyncing: false,
      lastSyncedAt: this.getLastSyncedAt(),
      syncError: null,
      isTokenExpired: Boolean(token && isExpired && !hasConvexSession),
    };
  }

  public logout(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem('auth_token_v1');
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(LAST_SYNC_KEY);
    } catch (e) {
      console.warn('Error clearing auth from localStorage', e);
    }
  }
}
