import { RemoteTimerState } from '../auth/AuthService';
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

export const broadcastTimerState = (timer: RemoteTimerState): void => {
  try {
    if (channel) {
      channel.postMessage({
        senderId: TAB_ID,
        type: 'TIMER',
        timer,
      } as TimerBroadcastEvent);
    }
  } catch (e) {
    console.warn('Timer BroadcastChannel error:', e);
  }
};

export const subscribeTimerState = (callback: (timer: RemoteTimerState) => void): (() => void) => {
  if (!channel) return () => {};

  const handler = (event: MessageEvent<TimerBroadcastEvent>) => {
    if (event.data && event.data.senderId !== TAB_ID && event.data.timer) {
      callback(event.data.timer);
    }
  };

  channel.addEventListener('message', handler);
  return () => {
    channel?.removeEventListener('message', handler);
  };
};

export const broadcastCoffeeCups = (coffeeCups: CoffeeCup[]): void => {
  try {
    if (channel) {
      channel.postMessage({
        senderId: TAB_ID,
        type: 'COFFEE',
        coffeeCups,
      } as TimerBroadcastEvent);
    }
  } catch (e) {
    console.warn('Coffee BroadcastChannel error:', e);
  }
};

export const subscribeCoffeeCups = (callback: (cups: CoffeeCup[]) => void): (() => void) => {
  if (!channel) return () => {};

  const handler = (event: MessageEvent<TimerBroadcastEvent>) => {
    if (event.data && event.data.senderId !== TAB_ID && event.data.coffeeCups) {
      callback(event.data.coffeeCups);
    }
  };

  channel.addEventListener('message', handler);
  return () => {
    channel?.removeEventListener('message', handler);
  };
};

export const broadcastTags = (tags: Tag[]): void => {
  try {
    if (channel) {
      channel.postMessage({
        senderId: TAB_ID,
        type: 'TAGS',
        tags,
      } as TimerBroadcastEvent);
    }
  } catch (e) {
    console.warn('Tags BroadcastChannel error:', e);
  }
};

export const subscribeTags = (callback: (tags: Tag[]) => void): (() => void) => {
  if (!channel) return () => {};

  const handler = (event: MessageEvent<TimerBroadcastEvent>) => {
    if (event.data && event.data.senderId !== TAB_ID && event.data.tags) {
      callback(event.data.tags);
    }
  };

  channel.addEventListener('message', handler);
  return () => {
    channel?.removeEventListener('message', handler);
  };
};

export const broadcastSession = (session: CompletedSession): void => {
  try {
    if (channel) {
      channel.postMessage({
        senderId: TAB_ID,
        type: 'SESSION',
        session,
      } as TimerBroadcastEvent);
    }
  } catch (e) {
    console.warn('Session BroadcastChannel error:', e);
  }
};

export const subscribeSessions = (callback: (session: CompletedSession) => void): (() => void) => {
  if (!channel) return () => {};

  const handler = (event: MessageEvent<TimerBroadcastEvent>) => {
    if (event.data && event.data.senderId !== TAB_ID && event.data.session) {
      callback(event.data.session);
    }
  };

  channel.addEventListener('message', handler);
  return () => {
    channel?.removeEventListener('message', handler);
  };
};

const localResetListeners = new Set<(scope: ResetScope) => void>();

export const broadcastReset = (resetScope: ResetScope): void => {
  // Notify local subscribers on this tab
  localResetListeners.forEach((fn) => {
    try {
      fn(resetScope);
    } catch (err) {
      console.warn('Local reset listener error:', err);
    }
  });

  // Post to peer tabs
  try {
    if (channel) {
      channel.postMessage({
        senderId: TAB_ID,
        type: 'RESET',
        resetScope,
      } as TimerBroadcastEvent);
    }
  } catch (e) {
    console.warn('Reset BroadcastChannel error:', e);
  }
};

export const subscribeReset = (callback: (scope: ResetScope) => void): (() => void) => {
  localResetListeners.add(callback);

  if (!channel) {
    return () => {
      localResetListeners.delete(callback);
    };
  }

  const handler = (event: MessageEvent<TimerBroadcastEvent>) => {
    if (event.data && event.data.senderId !== TAB_ID && event.data.type === 'RESET' && event.data.resetScope) {
      callback(event.data.resetScope);
    }
  };

  channel.addEventListener('message', handler);
  return () => {
    localResetListeners.delete(callback);
    channel?.removeEventListener('message', handler);
  };
};
