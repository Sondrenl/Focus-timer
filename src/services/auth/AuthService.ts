import { UserProfile, AuthState } from '../../types/user';
import { RemoteTimerState, PeerPresence } from '../../types/timer';
import { isMobileDevice } from '../../utils/environment';

export type { RemoteTimerState, PeerPresence };
export { isMobileDevice };

const TOKEN_KEY = 'focus_timer_auth_token';
const USER_KEY = 'focus_timer_user_profile';
const LAST_SYNC_KEY = 'focus_timer_last_synced_at';

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
