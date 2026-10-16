import { RemoteTimerState } from '../auth/AuthService';
import { CoffeeCup } from '../../types/coffee';

export interface TimerBroadcastEvent {
  senderId: string;
  type?: 'TIMER' | 'COFFEE';
  timer?: RemoteTimerState;
  coffeeCups?: CoffeeCup[];
}

const CHANNEL_NAME = 'focus_timer_sync_v1';
const TAB_ID = typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID()
  : `tab-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

let channel: BroadcastChannel | null = null;
try {
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    channel = new BroadcastChannel(CHANNEL_NAME);
  }
} catch {
  channel = null;
}

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
