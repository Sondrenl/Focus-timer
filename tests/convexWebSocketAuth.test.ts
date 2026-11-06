import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getValidAuthToken } from '../src/services/convex/ConvexClient';
import { AUTH_TOKEN_KEY } from '../src/services/auth/AuthService';

function createMockJwt(expTimestampSeconds: number, email = 'user@example.com'): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(
    JSON.stringify({
      sub: 'google-sub-123',
      email,
      name: 'Test Practitioner',
      exp: expTimestampSeconds,
    })
  );
  return `${header}.${payload}.mock_signature`;
}

describe('Convex WebSocket Token Expiration & Reconnection Resilience', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};

    const mockWindow = {
      localStorage: {
        getItem: (key: string) => mockStorage[key] || null,
        setItem: (key: string, val: string) => {
          mockStorage[key] = val;
        },
        removeItem: (key: string) => {
          delete mockStorage[key];
        },
        clear: () => {
          mockStorage = {};
        },
      },
    };

    vi.stubGlobal('window', mockWindow);
    vi.stubGlobal('localStorage', mockWindow.localStorage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('getValidAuthToken', () => {
    it('returns a valid token when not expired', () => {
      const futureExpiry = Math.floor(Date.now() / 1000) + 3600; // +1 hour
      const validToken = createMockJwt(futureExpiry);

      const result = getValidAuthToken(validToken);
      expect(result).toBe(validToken);
    });

    it('returns undefined when token is expired (payload.exp * 1000 <= Date.now())', () => {
      const pastExpiry = Math.floor(Date.now() / 1000) - 60; // -1 minute
      const expiredToken = createMockJwt(pastExpiry);

      const result = getValidAuthToken(expiredToken);
      expect(result).toBeUndefined();
    });

    it('returns undefined when candidate token expires at exact current timestamp', () => {
      const exactNow = Math.floor(Date.now() / 1000);
      const expiredToken = createMockJwt(exactNow);

      const result = getValidAuthToken(expiredToken);
      expect(result).toBeUndefined();
    });

    it('falls back to renewed token from localStorage if candidate is expired', () => {
      const pastExpiry = Math.floor(Date.now() / 1000) - 300;
      const expiredToken = createMockJwt(pastExpiry);

      const futureExpiry = Math.floor(Date.now() / 1000) + 3600;
      const renewedToken = createMockJwt(futureExpiry, 'renewed@example.com');
      mockStorage[AUTH_TOKEN_KEY] = renewedToken;

      const result = getValidAuthToken(expiredToken);
      expect(result).toBe(renewedToken);
    });

    it('returns undefined if candidate is expired and localStorage token is also expired', () => {
      const pastExpiry = Math.floor(Date.now() / 1000) - 300;
      const expiredToken = createMockJwt(pastExpiry);
      const expiredStoredToken = createMockJwt(pastExpiry - 100);
      mockStorage[AUTH_TOKEN_KEY] = expiredStoredToken;

      const result = getValidAuthToken(expiredToken);
      expect(result).toBeUndefined();
    });

    it('retrieves fresh token from localStorage when forceRefreshToken is requested', () => {
      const futureExpiry1 = Math.floor(Date.now() / 1000) + 1800;
      const initialToken = createMockJwt(futureExpiry1, 'initial@example.com');

      const futureExpiry2 = Math.floor(Date.now() / 1000) + 7200;
      const refreshedToken = createMockJwt(futureExpiry2, 'refreshed@example.com');
      mockStorage[AUTH_TOKEN_KEY] = refreshedToken;

      const result = getValidAuthToken(initialToken, { forceRefreshToken: true });
      expect(result).toBe(refreshedToken);
    });

    it('returns undefined when token is null and storage has no token', () => {
      const result = getValidAuthToken(null);
      expect(result).toBeUndefined();
    });

    it('returns valid storage token when null token is passed but storage has valid token', () => {
      const futureExpiry = Math.floor(Date.now() / 1000) + 3600;
      const validStored = createMockJwt(futureExpiry);
      mockStorage[AUTH_TOKEN_KEY] = validStored;

      const result = getValidAuthToken(null);
      expect(result).toBe(validStored);
    });

    it('safely handles malformed token string without crashing', () => {
      const result = getValidAuthToken('completely-malformed-token-xyz');
      // If payload is not valid JWT, it returns candidate (fallback for non-JWT auth) without crashing
      expect(result).toBe('completely-malformed-token-xyz');
    });

    it('safely handles localStorage access errors without throwing', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('SecurityError: LocalStorage is disabled');
        },
      });

      const pastExpiry = Math.floor(Date.now() / 1000) - 60;
      const expiredToken = createMockJwt(pastExpiry);

      expect(() => getValidAuthToken(expiredToken)).not.toThrow();
      expect(getValidAuthToken(expiredToken)).toBeUndefined();
    });
  });

  describe('Convex setAuth Callback & WebSocket Reconnection Resilience', () => {
    it('does NOT supply an expired token to Convex setAuth callback during scheduled refetch or reconnect', async () => {
      const pastExpiry = Math.floor(Date.now() / 1000) - 120;
      const expiredToken = createMockJwt(pastExpiry);

      // Simulate the callback registered with convexClient.setAuth
      const authCallback = async (args?: { forceRefreshToken?: boolean }) => {
        return getValidAuthToken(expiredToken, args);
      };

      // 1. Initial attempt with expired token should yield undefined
      const token1 = await authCallback({ forceRefreshToken: false });
      expect(token1).toBeUndefined();

      // 2. Scheduled refetch or reconnect with forceRefreshToken: true should still yield undefined
      const token2 = await authCallback({ forceRefreshToken: true });
      expect(token2).toBeUndefined();

      // 3. Once a renewed token is saved to localStorage (e.g. from background token refresh)
      const freshExpiry = Math.floor(Date.now() / 1000) + 3600;
      const freshToken = createMockJwt(freshExpiry, 'renewed@example.com');
      mockStorage[AUTH_TOKEN_KEY] = freshToken;

      // 4. WebSocket reconnection or retry now immediately receives the fresh token
      const token3 = await authCallback({ forceRefreshToken: true });
      expect(token3).toBe(freshToken);
    });
  });
});
