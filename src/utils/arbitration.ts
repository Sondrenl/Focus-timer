import { SessionType } from '../types/timer';

export interface PeerPresenceState {
  desktopActive: boolean;
  desktopVisible: boolean;
  mobileActive: boolean;
  mobileVisible: boolean;
}

/**
 * Pure evaluation function to determine if THIS device should trigger sound and notifications
 * upon session completion to avoid duplicate ringing when multiple devices are logged in.
 */
export function evaluateDeviceAlert({
  isMobile,
  isVisible,
  peer,
  type,
}: {
  isMobile: boolean;
  isVisible: boolean;
  peer: PeerPresenceState;
  type: SessionType;
}): boolean {
  if (isMobile) {
    if (isVisible) return true;
    if (type === 'WORK') {
      if (peer.desktopActive && !peer.desktopVisible) {
        return true;
      }
      return !peer.desktopActive;
    } else {
      if (peer.desktopActive && peer.desktopVisible) {
        return false;
      }
      return true;
    }
  } else {
    if (type === 'WORK') {
      return true;
    } else {
      if (isVisible) return true;
      return !peer.mobileActive;
    }
  }
}
