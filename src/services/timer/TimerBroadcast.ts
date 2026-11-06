import { RemoteTimerState } from '../../types/timer';
import { CoffeeCup } from '../../types/coffee';
import { Tag } from '../../types/tag';
import { CompletedSession } from '../../types/session';

export type ResetScope = 'sessions-only' | 'factory-reset';

export interface TimerBroadcastEvent {
  senderId: string;
  type?: 'TIMER' | 'COFFEE' | 'TAGS' | 'SESSION' | 'RESET' | 'TAB_HELLO' | 'TAB_ACK' | 'TAB_GOODBYE';
  timer?: RemoteTimerState;
  coffeeCups?: CoffeeCup[];
  tags?: Tag[];
  session?: CompletedSession;
  resetScope?: ResetScope;
}

const CHANNEL_NAME = 'focus_timer_sync_v1';
export const TAB_ID = typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID()
  : `tab-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

const MAX_PEER_TABS = 50;

function isValidSenderId(id: unknown): id is string {
  return typeof id === 'string' && id.length >= 8 && id.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(id);
}

const activePeerTabs = new Set<string>();

let channel: BroadcastChannel | null = null;
try {
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener('message', (event: MessageEvent<TimerBroadcastEvent>) => {
      const data = event.data;
      if (!data || !isValidSenderId(data.senderId) || data.senderId === TAB_ID) return;

      if (data.type === 'TAB_HELLO') {
        if (activePeerTabs.size < MAX_PEER_TABS) {
          activePeerTabs.add(data.senderId);
        }
        try {
          channel?.postMessage({ senderId: TAB_ID, type: 'TAB_ACK' } as TimerBroadcastEvent);
        } catch {
          // Ignore broadcast error
        }
      } else if (data.type === 'TAB_ACK') {
        if (activePeerTabs.size < MAX_PEER_TABS) {
          activePeerTabs.add(data.senderId);
        }
      } else if (data.type === 'TAB_GOODBYE') {
        activePeerTabs.delete(data.senderId);
      } else if (activePeerTabs.size < MAX_PEER_TABS) {
        activePeerTabs.add(data.senderId);
      }
    });

    // Announce presence to any existing open tabs
    channel.postMessage({ senderId: TAB_ID, type: 'TAB_HELLO' } as TimerBroadcastEvent);

    const announceGoodbye = () => {
      try {
        channel?.postMessage({ senderId: TAB_ID, type: 'TAB_GOODBYE' } as TimerBroadcastEvent);
      } catch {
        // Ignore
      }
    };
    window.addEventListener('pagehide', announceGoodbye);
  }
} catch {
  channel = null;
}

export const hasActivePeerTabs = (): boolean => {
  return activePeerTabs.size > 0;
};

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

const localResetListeners = new Set<(scope: ResetScope) => void>();

export const broadcastReset = (resetScope: ResetScope): void => {
  localResetListeners.forEach((fn) => {
    try {
      fn(resetScope);
    } catch (err) {
      console.warn('Local reset listener error:', err);
    }
  });

  broadcastPayload('RESET', 'resetScope', resetScope);
};

export const subscribeReset = (callback: (scope: ResetScope) => void): (() => void) => {
  localResetListeners.add(callback);
  const unsubscribeChannel = subscribePayload(
    'RESET',
    'resetScope',
    (p: any) => p === 'sessions-only' || p === 'factory-reset',
    callback
  );

  return () => {
    localResetListeners.delete(callback);
    unsubscribeChannel();
  };
};
