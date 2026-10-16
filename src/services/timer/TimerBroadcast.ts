import { RemoteTimerState } from '../auth/AuthService';

export interface TimerBroadcastEvent {
  senderId: string;
  timer: RemoteTimerState;
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
