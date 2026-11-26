import { UserProfile, AuthState } from '../../types/user';

export const AUTH_USER_KEY = 'auth_user_v2';

function escapeAuthNamespace(namespace: string): string {
  return namespace.replace(/[^a-zA-Z0-9]/g, '');
}

function isNonEmptyStorageVal(val: string | null): val is string {
  return Boolean(val && val !== 'null' && val !== '""' && val.trim().length > 0);
}

function parseJwtPayload(token: string): { exp?: unknown } | null {
  try {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4 || 4)) % 4), '=');
    const jsonPayload = decodeURIComponent(
      atob(padded)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const parsed = JSON.parse(jsonPayload);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as { exp?: unknown };
  } catch {
    return null;
  }
}

export function hasStoredConvexAuthSession(namespace?: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const storage = window.localStorage;
    if (!storage || typeof storage.getItem !== 'function') return false;

    const isJwtUnexpired = (rawJwt: string): boolean => {
      const payload = parseJwtPayload(rawJwt);
      return Boolean(
        payload &&
          typeof payload.exp === 'number' &&
          Number.isFinite(payload.exp) &&
          payload.exp * 1000 > Date.now() + 30_000
      );
    };

    if (namespace) {
      const escaped = escapeAuthNamespace(namespace);
      if (isNonEmptyStorageVal(storage.getItem(`__convexAuthRefreshToken_${escaped}`))) {
        return true;
      }
      const jwtVal = storage.getItem(`__convexAuthJWT_${escaped}`);
      return isNonEmptyStorageVal(jwtVal) && isJwtUnexpired(jwtVal);
    }

    if (typeof storage.length !== 'number' || typeof storage.key !== 'function') return false;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key) continue;
      if (key.startsWith('__convexAuthRefreshToken')) {
        if (isNonEmptyStorageVal(storage.getItem(key))) return true;
      } else if (key.startsWith('__convexAuthJWT')) {
        const val = storage.getItem(key);
        if (isNonEmptyStorageVal(val) && isJwtUnexpired(val)) return true;
      }
    }
  } catch {
    // Ignore storage access errors
  }
  return false;
}

export class AuthService {
  private static instance: AuthService;

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  public getStoredUser(): UserProfile | null {
    try {
      const data =
        localStorage.getItem(AUTH_USER_KEY) || localStorage.getItem('auth_user_v1');
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  public hasConvexAuthSession(namespace?: string): boolean {
    return hasStoredConvexAuthSession(namespace);
  }

  public saveAuthUser(user: UserProfile): void {
    try {
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    } catch (e) {
      console.warn('Could not persist auth user to localStorage', e);
    }
  }

  public getInitialAuthState(convexNamespace?: string): AuthState {
    const user = this.getStoredUser();
    const hasConvexSession = this.hasConvexAuthSession(convexNamespace);
    const isAuthenticated = Boolean(hasConvexSession && user);
    return {
      isAuthenticated,
      user: isAuthenticated ? user : null,
      token: null,
      isSyncing: false,
      lastSyncedAt: null,
      syncError: null,
      isTokenExpired: false,
    };
  }

  public logout(): void {
    try {
      localStorage.removeItem(AUTH_USER_KEY);
      localStorage.removeItem('auth_user_v1');

      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('__convexAuth') || k.startsWith('convex_'))) {
          keysToRemove.push(k);
        }
      }
      for (const k of keysToRemove) {
        localStorage.removeItem(k);
      }
    } catch (e) {
      console.warn('Error clearing auth from localStorage', e);
    }
  }
}
