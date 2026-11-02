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

const activePeerTabs = new Set<string>();

let channel: BroadcastChannel | null = null;
try {
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener('message', (event: MessageEvent<TimerBroadcastEvent>) => {
      const data = event.data;
      if (!data || data.senderId === TAB_ID) return;

      if (data.type === 'TAB_HELLO') {
        activePeerTabs.add(data.senderId);
        try {
          channel?.postMessage({ senderId: TAB_ID, type: 'TAB_ACK' } as TimerBroadcastEvent);
        } catch {
          // Ignore broadcast error
        }
      } else if (data.type === 'TAB_ACK') {
        activePeerTabs.add(data.senderId);
      } else if (data.type === 'TAB_GOODBYE') {
        activePeerTabs.delete(data.senderId);
      } else {
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
    window.addEventListener('beforeunload', announceGoodbye);
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
 * Generic helper to subscribe to typed events from peer tabs
 */
function subscribePayload<K extends keyof TimerBroadcastEvent>(
  key: K,
  callback: (payload: NonNullable<TimerBroadcastEvent[K]>) => void
): () => void {
  if (!channel) return () => {};

  const handler = (event: MessageEvent<TimerBroadcastEvent>) => {
    if (event.data && event.data.senderId !== TAB_ID && event.data[key]) {
      callback(event.data[key] as NonNullable<TimerBroadcastEvent[K]>);
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
  subscribePayload('timer', callback);

export const broadcastCoffeeCups = (coffeeCups: CoffeeCup[]): void =>
  broadcastPayload('COFFEE', 'coffeeCups', coffeeCups);

export const subscribeCoffeeCups = (callback: (cups: CoffeeCup[]) => void): (() => void) =>
  subscribePayload('coffeeCups', callback);

export const broadcastTags = (tags: Tag[]): void =>
  broadcastPayload('TAGS', 'tags', tags);

export const subscribeTags = (callback: (tags: Tag[]) => void): (() => void) =>
  subscribePayload('tags', callback);

export const broadcastSession = (session: CompletedSession): void =>
  broadcastPayload('SESSION', 'session', session);

export const subscribeSessions = (callback: (session: CompletedSession) => void): (() => void) =>
  subscribePayload('session', callback);

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
  const unsubscribeChannel = subscribePayload('resetScope', callback);

  return () => {
    localResetListeners.delete(callback);
    unsubscribeChannel();
  };
};
