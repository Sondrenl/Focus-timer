import { SessionType } from '../types/timer';

export interface PeerPresenceState {
  desktopActive: boolean;
  desktopVisible: boolean;
  mobileActive: boolean;
  mobileVisible: boolean;
  lastSeenMs?: number;
}

export const PRESENCE_TTL_MS = 90_000; // 90 seconds freshness TTL

/**
 * Pure evaluation function to determine if THIS device should trigger sound and notifications
 * upon session completion to avoid duplicate ringing when multiple devices are logged in.
 */
export function evaluateDeviceAlert({
  isMobile,
  isVisible,
  peer,
  type,
  now = Date.now(),
}: {
  isMobile: boolean;
  isVisible: boolean;
  peer: PeerPresenceState;
  type: SessionType;
  now?: number;
}): boolean {
  // If peer presence is stale (older than 90s), treat peer as inactive/offline
  const isPeerFresh = typeof peer.lastSeenMs === 'number'
    ? now - peer.lastSeenMs < PRESENCE_TTL_MS
    : true; // Backward compatibility if lastSeenMs is not provided

  const peerDesktopActive = isPeerFresh && peer.desktopActive;
  const peerDesktopVisible = isPeerFresh && peer.desktopVisible;
  const peerMobileActive = isPeerFresh && peer.mobileActive;

  if (isMobile) {
    if (isVisible) return true;
    if (type === 'WORK') {
      if (peerDesktopActive && !peerDesktopVisible) {
        return true;
      }
      return !peerDesktopActive;
    } else {
      if (peerDesktopActive && peerDesktopVisible) {
        return false;
      }
      return true;
    }
  } else {
    if (type === 'WORK') {
      return true;
    } else {
      if (isVisible) return true;
      return !peerMobileActive;
    }
  }
}
