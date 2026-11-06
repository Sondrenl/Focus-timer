import { describe, it, expect } from 'vitest';
import { evaluateDeviceAlert, PeerPresenceState } from '../src/utils/arbitration';

describe('Multi-Device Alert Arbitration', () => {
  const allInactive: PeerPresenceState = {
    desktopActive: false,
    desktopVisible: false,
    mobileActive: false,
    mobileVisible: false,
  };

  const desktopOpenAndInFront: PeerPresenceState = {
    desktopActive: true,
    desktopVisible: true,
    mobileActive: true,
    mobileVisible: false,
  };

  const desktopLidClosed: PeerPresenceState = {
    desktopActive: true,
    desktopVisible: false,
    mobileActive: true,
    mobileVisible: false,
  };

  describe('Focus Session (WORK) Completion Alerts', () => {
    it('always alerts desktop on WORK completion', () => {
      const desktopAlerts = evaluateDeviceAlert({
        isMobile: false,
        isVisible: true,
        peer: allInactive,
        type: 'WORK',
      });
      expect(desktopAlerts).toBe(true);
    });

    it('alerts mobile on WORK completion if desktop is closed/sleeping', () => {
      const mobileAlerts = evaluateDeviceAlert({
        isMobile: true,
        isVisible: false,
        peer: desktopLidClosed,
        type: 'WORK',
      });
      expect(mobileAlerts).toBe(true);
    });

    it('suppresses mobile WORK alert if user is actively in front of desktop', () => {
      const mobileAlerts = evaluateDeviceAlert({
        isMobile: true,
        isVisible: false,
        peer: desktopOpenAndInFront,
        type: 'WORK',
      });
      expect(mobileAlerts).toBe(false);
    });
  });

  describe('Break Session Completion Alerts', () => {
    it('alerts desktop if desktop tab is open and visible during break end', () => {
      const desktopAlerts = evaluateDeviceAlert({
        isMobile: false,
        isVisible: true,
        peer: { ...allInactive, mobileActive: true },
        type: 'SHORT_BREAK',
      });
      expect(desktopAlerts).toBe(true);
    });

    it('suppresses desktop break alert if desktop is hidden and mobile is active', () => {
      const desktopAlerts = evaluateDeviceAlert({
        isMobile: false,
        isVisible: false,
        peer: { ...allInactive, mobileActive: true },
        type: 'SHORT_BREAK',
      });
      expect(desktopAlerts).toBe(false);
    });

    it('alerts mobile on break completion if desktop is sleeping/closed', () => {
      const mobileAlerts = evaluateDeviceAlert({
        isMobile: true,
        isVisible: false,
        peer: desktopLidClosed,
        type: 'SHORT_BREAK',
      });
      expect(mobileAlerts).toBe(true);
    });

    it('suppresses mobile break alert if desktop is open and in front of user to prevent double-chime', () => {
      const mobileAlerts = evaluateDeviceAlert({
        isMobile: true,
        isVisible: false,
        peer: desktopOpenAndInFront,
        type: 'SHORT_BREAK',
      });
      expect(mobileAlerts).toBe(false);
    });

    it('does NOT suppress mobile alerts if desktop presence timestamp is stale (>90s)', () => {
      const now = 1000000;
      const staleDesktop: PeerPresenceState = {
        desktopActive: true,
        desktopVisible: true,
        mobileActive: true,
        mobileVisible: false,
        lastSeenMs: now - 120_000, // 2 minutes ago (>90s TTL)
      };

      const mobileAlerts = evaluateDeviceAlert({
        isMobile: true,
        isVisible: false,
        peer: staleDesktop,
        type: 'SHORT_BREAK',
        now,
      });
      // Should NOT be suppressed because desktop presence has expired!
      expect(mobileAlerts).toBe(true);
    });
  });
});
