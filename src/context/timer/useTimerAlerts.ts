import React, { useCallback, useRef } from 'react';
import { SessionType } from '../../types/timer';
import { UserSettings } from '../../types/settings';
import { SoundService } from '../../services/audio/SoundService';
import { NotificationService } from '../../services/notification/NotificationService';
import { getCompletionNotificationCopy } from '../../services/notification/notificationCopy';
import { triggerCompletionConfetti } from '../../utils/confetti';

interface UseTimerAlertsParams {
  timerRunIdRef: React.MutableRefObject<string | null>;
  settingsRef: React.MutableRefObject<UserSettings>;
  sound: SoundService;
  notifications: NotificationService;
}

export const useTimerAlerts = ({
  timerRunIdRef,
  settingsRef,
  sound,
  notifications,
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

      if (now - lastAlertWallMsRef.current < 4000) {
        return;
      }

      lastAlertWallMsRef.current = now;
      lastAlertRunIdRef.current = currentRunId || null;

      const currentSettings = settingsRef.current;
      const wantsNotification =
        currentSettings.notificationsEnabled && notifications.hasPermission();
      const isSilent = !currentSettings.soundEnabled;

      if (wantsNotification) {
        const { title, body } = getCompletionNotificationCopy(completedSessionType);

        // Let the OS notification service own the standard notification sound (or stay silent when muted).
        // Fall back to the in-app Web Audio chime only if OS notification delivery fails.
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
        // App is running without OS notifications — play the native Web Audio chime.
        sound.playChime(currentSettings.soundVolume);
      }
    },
    [notifications, sound, timerRunIdRef, settingsRef]
  );

  return {
    dispatchCompletionAlert,
    triggerCompletionConfetti,
  };
};
