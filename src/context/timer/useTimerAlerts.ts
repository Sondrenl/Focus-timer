import React, { useCallback, useRef } from 'react';
import { SessionType } from '../../types/timer';
import { UserSettings } from '../../types/settings';
import { SoundService } from '../../services/audio/SoundService';
import { NotificationService } from '../../services/notification/NotificationService';
import { getCompletionNotificationCopy } from '../../services/notification/notificationCopy';
import { triggerCompletionConfetti } from '../../utils/confetti';

export const CROSS_TAB_ALERT_CLAIM_KEY = 'pomodor_last_alert_run_v1';
const CROSS_TAB_RUN_CLAIM_TTL_MS = 60_000;
const FALLBACK_DEBOUNCE_MS = 4_000;

interface CrossTabAlertClaim {
  runId: string | null;
  ts: number;
  audible: boolean;
}

function readCrossTabClaim(): CrossTabAlertClaim | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CROSS_TAB_ALERT_CLAIM_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.ts === 'number' &&
      Number.isFinite(parsed.ts)
    ) {
      return {
        runId: typeof parsed.runId === 'string' ? parsed.runId : null,
        ts: parsed.ts,
        audible: Boolean(parsed.audible),
      };
    }
  } catch {
    // Ignore storage/parse errors
  }
  return null;
}

function writeCrossTabClaim(claim: CrossTabAlertClaim): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CROSS_TAB_ALERT_CLAIM_KEY, JSON.stringify(claim));
  } catch {
    // Ignore storage access errors (private browsing / quota)
  }
}

export interface UseTimerAlertsParams {
  timerRunIdRef: React.MutableRefObject<string | null>;
  settingsRef: React.MutableRefObject<UserSettings>;
  sound: SoundService;
  notifications: NotificationService;
  isEffectiveAuthenticatedRef?: React.MutableRefObject<boolean>;
  isConvexConnectedRef?: React.MutableRefObject<boolean>;
  isDevicePushRegisteredRef?: React.MutableRefObject<boolean | undefined>;
}

export const useTimerAlerts = ({
  timerRunIdRef,
  settingsRef,
  sound,
  notifications,
  isEffectiveAuthenticatedRef,
  isConvexConnectedRef,
  isDevicePushRegisteredRef,
}: UseTimerAlertsParams) => {
  const lastAlertWallMsRef = useRef<number>(0);
  const lastAlertRunIdRef = useRef<string | null>(null);

  const dispatchCompletionAlert = useCallback(
    (completedSessionType: SessionType, runId?: string | null) => {
      const now = Date.now();
      const currentRunId = runId || timerRunIdRef.current;

      if (currentRunId && lastAlertRunIdRef.current === currentRunId) {
        return;
      }

      // Only apply the 4-second wall-clock debounce when no runId is available;
      // distinct short intervals (e.g., 1-3s test sessions) have unique runIds and must not be dropped.
      if (!currentRunId && now - lastAlertWallMsRef.current < FALLBACK_DEBOUNCE_MS) {
        return;
      }

      const currentSettings = settingsRef.current;
      const wantsNotification =
        currentSettings.notificationsEnabled && notifications.hasPermission();
      const isSilent = !currentSettings.soundEnabled;
      const isVisible =
        typeof document !== 'undefined' && document.visibilityState === 'visible';
      const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
      const isAuth = isEffectiveAuthenticatedRef ? isEffectiveAuthenticatedRef.current : true;
      const isConnected = isConvexConnectedRef ? isConvexConnectedRef.current : true;
      const isServerRegistered = isDevicePushRegisteredRef
        ? isDevicePushRegisteredRef.current
        : undefined;

      // Delegate OS push to Convex only when we have live proof that this device is signed in,
      // online, connected to Convex, has an active local push subscription, and has not been pruned server-side.
      const canDelegateToWebPush =
        isOnline &&
        isAuth &&
        isConnected &&
        notifications.getPushStatus() === 'active' &&
        isServerRegistered !== false;

      const willProduceLocalAlert = isVisible
        ? currentSettings.soundEnabled || (wantsNotification && !canDelegateToWebPush)
        : !wantsNotification
          ? currentSettings.soundEnabled
          : !canDelegateToWebPush;

      // Cross-tab deduplication: prevent two open tabs from firing double chimes or double local alerts.
      // If a hidden tab claimed first with audible=false (server push delegation), a visible tab is still
      // allowed to upgrade the claim and play the instant in-app chime.
      const existingClaim = readCrossTabClaim();
      if (existingClaim) {
        const matchesSameRun =
          Boolean(currentRunId) &&
          existingClaim.runId === currentRunId &&
          now - existingClaim.ts < CROSS_TAB_RUN_CLAIM_TTL_MS;
        const matchesFallbackWindow =
          !currentRunId && now - existingClaim.ts < FALLBACK_DEBOUNCE_MS;

        if (matchesSameRun || matchesFallbackWindow) {
          if (existingClaim.audible || !willProduceLocalAlert) {
            return;
          }
        }
      }

      lastAlertWallMsRef.current = now;
      lastAlertRunIdRef.current = currentRunId || null;
      writeCrossTabClaim({
        runId: currentRunId || null,
        ts: now,
        audible: willProduceLocalAlert,
      });

      if (isVisible) {
        // Decision 2A: When the app is open and visible on screen, always play the instant
        // in-app Web Audio chime if sound is enabled (sw.js silences incoming Web Push while visible).
        if (currentSettings.soundEnabled) {
          sound.playChime(currentSettings.soundVolume);
        }

        // If the user wants OS notifications and server Web Push isn't active on this device,
        // still display a quiet visual banner (silent: true prevents double sound alongside the chime).
        if (wantsNotification && !canDelegateToWebPush) {
          const { title, body } = getCompletionNotificationCopy(completedSessionType);
          void notifications
            .notify(title, body, false, currentRunId, { silent: true })
            .catch(() => false);
        }
        return;
      }

      // App is backgrounded / hidden / screen locked
      if (wantsNotification) {
        if (canDelegateToWebPush) {
          // Server Web Push is verified active & connected — let Convex deliver the single OS alert.
          return;
        }

        const { title, body } = getCompletionNotificationCopy(completedSessionType);

        // Signed-out, offline, disconnected, server-pruned, or non-push device: dispatch local OS notification.
        // Fall back to in-app Web Audio chime only if OS notification delivery fails.
        void notifications
          .notify(title, body, false, currentRunId, { silent: isSilent })
          .catch(() => false)
          .then((sent) => {
            const latest = settingsRef.current;
            if (!sent && latest.soundEnabled) {
              sound.playChime(latest.soundVolume);
            }
          });
      } else if (currentSettings.soundEnabled) {
        sound.playChime(currentSettings.soundVolume);
      }
    },
    [
      notifications,
      sound,
      timerRunIdRef,
      settingsRef,
      isEffectiveAuthenticatedRef,
      isConvexConnectedRef,
      isDevicePushRegisteredRef,
    ]
  );

  const clearAlertClaim = useCallback((runId?: string | null) => {
    if (!runId) return;
    if (lastAlertRunIdRef.current === runId) {
      lastAlertRunIdRef.current = null;
      lastAlertWallMsRef.current = 0;
    }
    const existingClaim = readCrossTabClaim();
    if (existingClaim && existingClaim.runId === runId && typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(CROSS_TAB_ALERT_CLAIM_KEY);
      } catch {
        // Ignore storage errors
      }
    }
  }, []);

  return {
    dispatchCompletionAlert,
    clearAlertClaim,
    triggerCompletionConfetti,
  };
};
