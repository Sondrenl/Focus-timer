import React, { useCallback, useRef } from 'react';
import { SessionType, TimerStatus, PeerPresence } from '../../types/timer';
import { UserSettings } from '../../types/settings';
import type { useApp } from '../AppContext';
import { evaluateDeviceAlert } from '../../utils/arbitration';
import { triggerCompletionConfetti } from '../../utils/confetti';
import { IS_MOBILE } from './timerPersistence';

interface UseTimerAlertsParams {
  statusRef: React.MutableRefObject<TimerStatus>;
  sessionTypeRef: React.MutableRefObject<SessionType>;
  targetEndTimeRef: React.MutableRefObject<number | null>;
  timerRunIdRef: React.MutableRefObject<string | null>;
  settingsRef: React.MutableRefObject<UserSettings>;
  peerPresenceRef: React.MutableRefObject<PeerPresence>;
  sound: ReturnType<typeof useApp>['sound'];
  notifications: ReturnType<typeof useApp>['notifications'];
}

export const useTimerAlerts = ({
  statusRef,
  sessionTypeRef,
  targetEndTimeRef,
  timerRunIdRef,
  settingsRef,
  peerPresenceRef,
  sound,
  notifications,
}: UseTimerAlertsParams) => {
  const lastAlertWallMsRef = useRef<number>(0);
  const lastAlertRunIdRef = useRef<string | null>(null);

  /**
   * Determines whether THIS device should play the completion chime and show the notification:
   */
  const shouldThisDeviceAlert = useCallback(
    (type: SessionType): boolean => {
      const isVisible = typeof document !== 'undefined' && document.visibilityState === 'visible';
      return evaluateDeviceAlert({
        isMobile: IS_MOBILE,
        isVisible,
        peer: peerPresenceRef.current,
        type,
      });
    },
    [peerPresenceRef]
  );

  const syncScheduledNotification = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (statusRef.current !== 'RUNNING' || !targetEndTimeRef.current) {
      notifications.cancelScheduledNotification();
      return;
    }

    const currentType = sessionTypeRef.current;
    const shouldAlert = shouldThisDeviceAlert(currentType);
    const runId = timerRunIdRef.current;

    if (settingsRef.current.notificationsEnabled && notifications.hasPermission()) {
      notifications.scheduleTimerNotification(
        targetEndTimeRef.current,
        currentType,
        shouldAlert,
        runId
      );
    } else {
      notifications.cancelScheduledNotification();
    }
  }, [
    notifications,
    shouldThisDeviceAlert,
    statusRef,
    targetEndTimeRef,
    sessionTypeRef,
    timerRunIdRef,
    settingsRef,
  ]);

  const dispatchCompletionAlert = useCallback(
    (completedSessionType: SessionType, runId?: string | null) => {
      const now = Date.now();
      const currentRunId = runId || timerRunIdRef.current;

      if (currentRunId && lastAlertRunIdRef.current === currentRunId) {
        return;
      }

      if (now - lastAlertWallMsRef.current < 4000) {
        return;
      }

      lastAlertWallMsRef.current = now;
      lastAlertRunIdRef.current = currentRunId || null;

      const currentSettings = settingsRef.current;
      const willAlert = shouldThisDeviceAlert(completedSessionType);

      if (!willAlert) {
        return;
      }

      if (currentSettings.notificationsEnabled) {
        const title =
          completedSessionType === 'WORK'
            ? 'Pomodor — Focus session complete'
            : 'Pomodor — Break session complete';
        const body =
          completedSessionType === 'WORK'
            ? 'Your focus timer has finished. Time for a break.'
            : 'Your break timer has finished. Time for a focus session.';

        notifications.notify(title, body, false, currentRunId);
      }

      if (currentSettings.soundEnabled) {
        sound.playChime(currentSettings.soundVolume);
      }
    },
    [notifications, sound, shouldThisDeviceAlert, timerRunIdRef, settingsRef]
  );

  return {
    shouldThisDeviceAlert,
    syncScheduledNotification,
    dispatchCompletionAlert,
    triggerCompletionConfetti,
  };
};
