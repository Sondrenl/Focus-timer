import { PeerPresence, SessionType } from '../types/timer';

export type PeerPresenceState = PeerPresence;

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
  // Prefer device-specific desktopLastSeenMs when available so a mobile heartbeat
  // cannot artificially refresh a stale desktop presence (and vice versa).
  const desktopSeenMs =
    typeof peer.desktopLastSeenMs === 'number' ? peer.desktopLastSeenMs : peer.lastSeenMs;
  const isDesktopFresh =
    typeof desktopSeenMs === 'number' ? now - desktopSeenMs < PRESENCE_TTL_MS : true;

  const peerDesktopActive = isDesktopFresh && peer.desktopActive;
  const peerDesktopVisible = isDesktopFresh && peer.desktopVisible;

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
    // Desktop devices must always alert upon completion (both focus and break sessions)
    // regardless of whether the browser tab is hidden or backgrounded, ensuring break completions
    // are never missed while the user is working or browsing elsewhere.
    return true;
  }
}
