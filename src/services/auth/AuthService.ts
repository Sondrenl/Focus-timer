export interface RemoteTimerState {
  sessionType: "WORK" | "SHORT_BREAK" | "LONG_BREAK";
  status: "IDLE" | "RUNNING" | "PAUSED" | "COMPLETED";
  remainingSeconds: number;
  totalSeconds: number;
  targetEndTime: number | null;
  currentCycle: number;
  activeTagId: string | null;
  timerRunId: string | null;
  updatedAtMs: number;
}

export interface RemoteTimerResult {
  timer: RemoteTimerState | null;
  coffeeCups?: CoffeeCup[];
  deletedCoffeeCupIds?: string[];
  tags?: Tag[];
  deletedTagIds?: string[];
  serverTime?: number;
}

import { UserProfile, AuthState } from '../../types/user';
import { Tag } from '../../types/tag';
import { CompletedSession } from '../../types/session';
import { UserSettings } from '../../types/settings';
import { CoffeeCup } from '../../types/coffee';

const TOKEN_KEY = 'focus_timer_auth_token';
const USER_KEY = 'focus_timer_cloud_user';
const LAST_SYNC_KEY = 'focus_timer_last_synced_at';
const DELETED_TAGS_KEY = 'focus_timer_deleted_tag_ids';
const DELETED_COFFEE_CUPS_KEY = 'focus_timer_deleted_coffee_cup_ids';
const CLOCK_OFFSET_KEY = 'focus_timer_clock_offset';

export interface CloudDataResponse {
  profile: UserProfile | null;
  tags: Tag[];
  deletedTagIds?: string[];
  deletedCoffeeCupIds?: string[];
  sessions: CompletedSession[];
  settings: UserSettings | null;
  coffeeCups?: CoffeeCup[];
  syncedAt: string;
  serverTime?: number;
}

export class AuthService {
  private static instance: AuthService;
  private clockOffset: number = (() => {
    try {
      const stored = localStorage.getItem(CLOCK_OFFSET_KEY);
      return stored ? parseInt(stored, 10) || 0 : 0;
    } catch {
      return 0;
    }
  })();

  private constructor() {}

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  /**
   * Return clock offset between local client Date.now() and server time in ms.
   * serverNow = Date.now() + clockOffset
   */
  public getClockOffset(): number {
    return this.clockOffset;
  }

  /**
   * Return high-precision calibrated server time.
   */
  public getServerNow(): number {
    return Date.now() + this.clockOffset;
  }

  /**
   * Update clock offset from server-reported timestamp using NTP-style round-trip midpoint estimation.
   */
  public updateClockOffset(serverTime: number, requestStartTime: number, requestEndTime: number): void {
    const roundTrip = Math.max(0, requestEndTime - requestStartTime);
    // Ignore updates with abnormal network lag (> 6000ms) to avoid skew distortion
    if (roundTrip > 6000) return;

    const clientMidpoint = requestStartTime + roundTrip / 2;
    const measuredOffset = Math.round(serverTime - clientMidpoint);

    if (this.clockOffset === 0) {
      this.clockOffset = measuredOffset;
    } else {
      // Exponential moving average (70% previous, 30% new) to smooth out network jitter
      this.clockOffset = Math.round(this.clockOffset * 0.7 + measuredOffset * 0.3);
    }

    try {
      localStorage.setItem(CLOCK_OFFSET_KEY, this.clockOffset.toString());
    } catch {
      // Storage errors ignored
    }
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

  public getDeletedTagIds(): Set<string> {
    try {
      const raw = localStorage.getItem(DELETED_TAGS_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  }

  public addDeletedTagId(id: string): void {
    try {
      const set = this.getDeletedTagIds();
      set.add(id);
      localStorage.setItem(DELETED_TAGS_KEY, JSON.stringify(Array.from(set)));
    } catch (e) {
      console.warn('Error recording deleted tag ID', e);
    }
  }

  public clearDeletedTagIds(): void {
    try {
      localStorage.removeItem(DELETED_TAGS_KEY);
    } catch (e) {
      console.warn('Error clearing deleted tags', e);
    }
  }

  public getDeletedCoffeeCupIds(): Set<string> {
    try {
      const raw = localStorage.getItem(DELETED_COFFEE_CUPS_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  }

  public addDeletedCoffeeCupId(id: string): void {
    try {
      const set = this.getDeletedCoffeeCupIds();
      set.add(id);
      localStorage.setItem(DELETED_COFFEE_CUPS_KEY, JSON.stringify(Array.from(set)));
    } catch (e) {
      console.warn('Error recording deleted coffee cup ID', e);
    }
  }

  public removeDeletedCoffeeCupId(id: string): void {
    try {
      const set = this.getDeletedCoffeeCupIds();
      if (set.has(id)) {
        set.delete(id);
        localStorage.setItem(DELETED_COFFEE_CUPS_KEY, JSON.stringify(Array.from(set)));
      }
    } catch (e) {
      console.warn('Error removing deleted coffee cup ID', e);
    }
  }

  public clearDeletedCoffeeCupIds(): void {
    try {
      localStorage.removeItem(DELETED_COFFEE_CUPS_KEY);
    } catch (e) {
      console.warn('Error clearing deleted coffee cups', e);
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

    const data = (await res.json()) as { token: string; user: UserProfile; serverTime?: number };

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
      localStorage.removeItem(DELETED_TAGS_KEY);
      localStorage.removeItem(DELETED_COFFEE_CUPS_KEY);
    } catch (e) {
      console.warn('Error clearing auth state', e);
    }
  }

  public async upsertTagRemote(tag: Tag): Promise<Tag[] | null> {
    const token = this.getStoredToken();
    if (!token) return null;

    try {
      const res = await fetch('/api/tags', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tag }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { success: boolean; tags?: Tag[] };
      return data.tags || null;
    } catch (e) {
      console.warn('Failed to upsert tag on remote server', e);
      return null;
    }
  }

  public async deleteTag(tagId: string): Promise<void> {
    this.addDeletedTagId(tagId);
    const token = this.getStoredToken();
    if (!token) return;

    try {
      await fetch(`/api/tags/${encodeURIComponent(tagId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (e) {
      console.warn('Failed to delete tag on remote server', e);
    }
  }

  public async fetchCloudData(): Promise<CloudDataResponse | null> {
    const token = this.getStoredToken();
    if (!token) return null;

    const t0 = Date.now();
    const res = await fetch('/api/sync', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const t1 = Date.now();

    if (!res.ok) {
      throw new Error('Failed to fetch cloud data');
    }

    const data = (await res.json()) as CloudDataResponse;
    if (typeof data.serverTime === 'number') {
      this.updateClockOffset(data.serverTime, t0, t1);
    }
    if (data.syncedAt) {
      localStorage.setItem(LAST_SYNC_KEY, data.syncedAt);
    }
    return data;
  }

  public async pushCloudData(payload: {
    mode?: 'merge' | 'replace';
    profile?: Partial<UserProfile>;
    tags?: Tag[];
    deletedTagIds?: string[];
    deletedCoffeeCupIds?: string[];
    clearSessions?: boolean;
    sessions?: CompletedSession[];
    coffeeCups?: CoffeeCup[];
    settings?: UserSettings;
  }): Promise<{ success: boolean; syncedAt: string; serverTime?: number }> {
    const token = this.getStoredToken();
    if (!token) throw new Error('Not authenticated');

    const t0 = Date.now();
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const t1 = Date.now();

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).error || 'Failed to sync with cloud');
    }

    const data = (await res.json()) as { success: boolean; syncedAt: string; serverTime?: number };
    if (typeof data.serverTime === 'number') {
      this.updateClockOffset(data.serverTime, t0, t1);
    }
    if (data.syncedAt) {
      localStorage.setItem(LAST_SYNC_KEY, data.syncedAt);
    }
    return data;
  }

  public async fetchRemoteTimer(isRunning: boolean = false): Promise<RemoteTimerResult | null> {
    const token = this.getStoredToken();
    if (!token) return null;

    try {
      const t0 = Date.now();
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (isRunning) {
        headers['X-Timer-Heartbeat'] = '1';
      }
      const res = await fetch('/api/timer', { headers });
      const t1 = Date.now();
      if (!res.ok) return null;
      const data = (await res.json()) as {
        timer: RemoteTimerState | null;
        coffeeCups?: CoffeeCup[];
        deletedCoffeeCupIds?: string[];
        tags?: Tag[];
        deletedTagIds?: string[];
        serverTime?: number;
      };
      if (typeof data.serverTime === 'number') {
        this.updateClockOffset(data.serverTime, t0, t1);
      }
      return data;
    } catch {
      return null;
    }
  }

  public async pushRemoteTimer(timer: RemoteTimerState): Promise<{ success: boolean; updatedAtMs?: number } | null> {
    const token = this.getStoredToken();
    if (!token) return null;

    try {
      const t0 = Date.now();
      const res = await fetch("/api/timer", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(timer),
      });
      const t1 = Date.now();
      if (!res.ok) return null;
      const data = (await res.json()) as { success: boolean; updatedAtMs?: number; serverTime?: number };
      if (typeof data.serverTime === 'number') {
        this.updateClockOffset(data.serverTime, t0, t1);
      }
      return data;
    } catch (e) {
      console.warn("Failed to push remote timer", e);
      return null;
    }
  }

  public async addCoffeeCupRemote(cup: CoffeeCup): Promise<CoffeeCup[] | null> {
    const token = this.getStoredToken();
    if (!token) return null;

    try {
      const res = await fetch('/api/coffee', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'ADD', cup }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { success: boolean; coffeeCups: CoffeeCup[] };
      return data.coffeeCups;
    } catch (e) {
      console.warn('Failed to add coffee cup to remote server', e);
      return null;
    }
  }

  public async removeCoffeeCupRemote(cupId: string): Promise<CoffeeCup[] | null> {
    this.addDeletedCoffeeCupId(cupId);
    const token = this.getStoredToken();
    if (!token) return null;

    try {
      const res = await fetch('/api/coffee', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'REMOVE', cupId }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { success: boolean; coffeeCups: CoffeeCup[] };
      return data.coffeeCups;
    } catch (e) {
      console.warn('Failed to remove coffee cup from remote server', e);
      return null;
    }
  }
}
