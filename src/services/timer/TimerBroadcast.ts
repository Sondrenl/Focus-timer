import { RemoteTimerState } from '../../types/timer';
import { CoffeeCup } from '../../types/coffee';
import { Tag } from '../../types/tag';
import { CompletedSession } from '../../types/session';
import { UserSettings } from '../../types/settings';
import { UserProfile } from '../../types/user';

export type ResetScope = 'sessions-only' | 'factory-reset';

export interface AuthBroadcastPayload {
  action: 'logout' | 'login';
  userId?: string | null;
}

export interface TimerBroadcastEvent {
  senderId: string;
  type?: 'TIMER' | 'COFFEE' | 'TAGS' | 'SESSION' | 'SESSIONS_SYNC' | 'SETTINGS' | 'PROFILE' | 'AUTH' | 'RESET';
  timer?: RemoteTimerState;
  coffeeCups?: CoffeeCup[];
  tags?: Tag[];
  session?: CompletedSession;
  sessions?: CompletedSession[];
  settings?: Partial<UserSettings>;
  profile?: Partial<UserProfile>;
  auth?: AuthBroadcastPayload;
  resetScope?: ResetScope;
}

const CHANNEL_NAME = 'focus_timer_sync_v1';
export const TAB_ID = typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID()
  : `tab-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

function isValidSenderId(id: unknown): id is string {
  return typeof id === 'string' && id.length >= 8 && id.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(id);
}

let channel: BroadcastChannel | null = null;
try {
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    channel = new BroadcastChannel(CHANNEL_NAME);
  }
} catch {
  channel = null;
}

/**
 * Generic helper to broadcast typed events to peer tabs
 */
function broadcastPayload<K extends keyof TimerBroadcastEvent>(
  type: TimerBroadcastEvent['type'],
  key: K,
  payload: NonNullable<TimerBroadcastEvent[K]>
): void {
  try {
    if (channel) {
      channel.postMessage({
        senderId: TAB_ID,
        type,
        [key]: payload,
      } as TimerBroadcastEvent);
    }
  } catch (e) {
    console.warn(`${String(type)} BroadcastChannel error:`, e);
  }
}

/**
 * Generic helper to subscribe to typed events from peer tabs with strict type and sender verification
 */
function subscribePayload<K extends keyof TimerBroadcastEvent>(
  expectedType: TimerBroadcastEvent['type'],
  key: K,
  validator: (payload: unknown) => boolean,
  callback: (payload: NonNullable<TimerBroadcastEvent[K]>) => void
): () => void {
  if (!channel) return () => {};

  const handler = (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    const record = data as Record<string, unknown>;
    if (!isValidSenderId(record.senderId) || record.senderId === TAB_ID) return;
    if (record.type !== expectedType) return;

    const payload = record[key as string];
    if (payload !== undefined && payload !== null && validator(payload)) {
      callback(payload as NonNullable<TimerBroadcastEvent[K]>);
    }
  };

  channel.addEventListener('message', handler);
  return () => {
    channel?.removeEventListener('message', handler);
  };
}

export const broadcastTimerState = (timer: RemoteTimerState): void =>
  broadcastPayload('TIMER', 'timer', timer);

export const subscribeTimerState = (callback: (timer: RemoteTimerState) => void): (() => void) =>
  subscribePayload('TIMER', 'timer', (p: any) => p && typeof p === 'object' && typeof p.status === 'string' && typeof p.updatedAtMs === 'number', callback);

export const broadcastCoffeeCups = (coffeeCups: CoffeeCup[]): void =>
  broadcastPayload('COFFEE', 'coffeeCups', coffeeCups);

export const subscribeCoffeeCups = (callback: (cups: CoffeeCup[]) => void): (() => void) =>
  subscribePayload('COFFEE', 'coffeeCups', (p: any) => Array.isArray(p), callback);

export const broadcastTags = (tags: Tag[]): void =>
  broadcastPayload('TAGS', 'tags', tags);

export const subscribeTags = (callback: (tags: Tag[]) => void): (() => void) =>
  subscribePayload('TAGS', 'tags', (p: any) => Array.isArray(p), callback);

export const broadcastSession = (session: CompletedSession): void =>
  broadcastPayload('SESSION', 'session', session);

export const subscribeSessions = (callback: (session: CompletedSession) => void): (() => void) =>
  subscribePayload('SESSION', 'session', (p: any) => p && typeof p === 'object' && typeof p.id === 'string', callback);

export const broadcastSessionsSync = (sessions: CompletedSession[]): void =>
  broadcastPayload('SESSIONS_SYNC', 'sessions', sessions);

export const subscribeSessionsSync = (callback: (sessions: CompletedSession[]) => void): (() => void) =>
  subscribePayload('SESSIONS_SYNC', 'sessions', (p: any) => Array.isArray(p), callback);

export const broadcastSettings = (settings: Partial<UserSettings>): void =>
  broadcastPayload('SETTINGS', 'settings', settings);

export const subscribeSettings = (callback: (settings: Partial<UserSettings>) => void): (() => void) =>
  subscribePayload('SETTINGS', 'settings', (p: any) => p && typeof p === 'object' && !Array.isArray(p), callback);

export const broadcastProfile = (profile: Partial<UserProfile>): void =>
  broadcastPayload('PROFILE', 'profile', profile);

export const subscribeProfile = (callback: (profile: Partial<UserProfile>) => void): (() => void) =>
  subscribePayload('PROFILE', 'profile', (p: any) => p && typeof p === 'object' && !Array.isArray(p), callback);

export interface BroadcastMeta {
  isRemoteTab: boolean;
}

export type ResetBroadcastMeta = BroadcastMeta;

const localAuthListeners = new Set<(payload: AuthBroadcastPayload, meta: BroadcastMeta) => void>();

export const broadcastAuthEvent = (payload: AuthBroadcastPayload): void => {
  localAuthListeners.forEach((fn) => {
    try {
      fn(payload, { isRemoteTab: false });
    } catch (err) {
      console.warn('Local auth listener error:', err);
    }
  });

  broadcastPayload('AUTH', 'auth', payload);
};

export const subscribeAuthEvent = (
  callback: (payload: AuthBroadcastPayload, meta: BroadcastMeta) => void
): (() => void) => {
  localAuthListeners.add(callback);
  const unsubscribeChannel = subscribePayload(
    'AUTH',
    'auth',
    (p: any) => p && typeof p === 'object' && (p.action === 'logout' || p.action === 'login'),
    (payload) => callback(payload, { isRemoteTab: true })
  );

  return () => {
    localAuthListeners.delete(callback);
    unsubscribeChannel();
  };
};

const localResetListeners = new Set<(scope: ResetScope, meta: ResetBroadcastMeta) => void>();

export const broadcastReset = (resetScope: ResetScope): void => {
  localResetListeners.forEach((fn) => {
    try {
      fn(resetScope, { isRemoteTab: false });
    } catch (err) {
      console.warn('Local reset listener error:', err);
    }
  });

  broadcastPayload('RESET', 'resetScope', resetScope);
};

export const subscribeReset = (
  callback: (scope: ResetScope, meta: ResetBroadcastMeta) => void
): (() => void) => {
  localResetListeners.add(callback);
  const unsubscribeChannel = subscribePayload(
    'RESET',
    'resetScope',
    (p: any) => p === 'sessions-only' || p === 'factory-reset',
    (scope) => callback(scope, { isRemoteTab: true })
  );

  return () => {
    localResetListeners.delete(callback);
    unsubscribeChannel();
  };
};
