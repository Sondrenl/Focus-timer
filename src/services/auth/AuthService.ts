import { UserProfile, AuthState } from '../../types/user';
import { Tag } from '../../types/tag';
import { CompletedSession } from '../../types/session';
import { UserSettings } from '../../types/settings';

const TOKEN_KEY = 'focus_timer_auth_token';
const USER_KEY = 'focus_timer_cloud_user';
const LAST_SYNC_KEY = 'focus_timer_last_synced_at';

export interface CloudDataResponse {
  profile: UserProfile | null;
  tags: Tag[];
  sessions: CompletedSession[];
  settings: UserSettings | null;
  syncedAt: string;
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

  public async loginWithGoogle(idToken: string): Promise<{ token: string; user: UserProfile }> {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).error || 'Failed to authenticate with Google');
    }

    const data = (await res.json()) as { token: string; user: UserProfile };

    try {
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    } catch (e) {
      console.warn('Could not persist auth token to localStorage', e);
    }

    return data;
  }

  public async verifySession(): Promise<UserProfile | null> {
    const token = this.getStoredToken();
    if (!token) return null;

    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        this.logout();
        return null;
      }

      const data = (await res.json()) as { user: UserProfile };
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      return data.user;
    } catch {
      return this.getStoredUser();
    }
  }

  public logout(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(LAST_SYNC_KEY);
    } catch (e) {
      console.warn('Error clearing auth state', e);
    }
  }

  public async fetchCloudData(): Promise<CloudDataResponse | null> {
    const token = this.getStoredToken();
    if (!token) return null;

    const res = await fetch('/api/sync', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error('Failed to fetch cloud data');
    }

    const data = (await res.json()) as CloudDataResponse;
    if (data.syncedAt) {
      localStorage.setItem(LAST_SYNC_KEY, data.syncedAt);
    }
    return data;
  }

  public async pushCloudData(payload: {
    profile?: Partial<UserProfile>;
    tags?: Tag[];
    sessions?: CompletedSession[];
    settings?: UserSettings;
  }): Promise<{ success: boolean; syncedAt: string }> {
    const token = this.getStoredToken();
    if (!token) throw new Error('Not authenticated');

    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).error || 'Failed to sync with cloud');
    }

    const data = (await res.json()) as { success: boolean; syncedAt: string };
    if (data.syncedAt) {
      localStorage.setItem(LAST_SYNC_KEY, data.syncedAt);
    }
    return data;
  }
}
