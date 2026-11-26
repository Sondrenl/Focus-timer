import React, { useState, useEffect, useRef } from 'react';
import { Card } from '../ui/Card';
import { Switch } from '../ui/Switch';
import { Volume2, Bell } from 'lucide-react';
import { UserSettings } from '../../types/settings';
import { SoundService } from '../../services/audio/SoundService';
import {
  NotificationService,
  NotificationPermissionStatus,
  PushSubscriptionStatus,
} from '../../services/notification/NotificationService';
import { getCompletionNotificationCopy } from '../../services/notification/notificationCopy';

interface SoundNotificationSectionProps {
  settings: UserSettings;
  updateSettings: (updates: Partial<UserSettings>) => void | Promise<void>;
  sound: SoundService;
  notifications: NotificationService;
  onSaved: () => void;
  pushStatus?: PushSubscriptionStatus;
  isPushAuthenticated?: boolean;
  onSyncPush?: () => Promise<{ ok: boolean; status: PushSubscriptionStatus; reason?: string }>;
  onUnsubscribePush?: () => Promise<void>;
  onScheduleTestPush?: () => Promise<{ scheduled: boolean; reason?: string }>;
}

export const SoundNotificationSection: React.FC<SoundNotificationSectionProps> = ({
  settings,
  updateSettings,
  sound,
  notifications,
  onSaved,
  pushStatus = 'unsubscribed',
  isPushAuthenticated = false,
  onSyncPush,
  onUnsubscribePush,
  onScheduleTestPush,
}) => {
  const [permissionState, setPermissionState] = useState<NotificationPermissionStatus>(() =>
    notifications.getPermissionState()
  );
  const [notifFeedback, setNotifFeedback] = useState<string | null>(null);
  const [isSchedulingTestPush, setIsSchedulingTestPush] = useState(false);
  const notifFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (notifFeedbackTimeoutRef.current !== null) {
        clearTimeout(notifFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const refreshPermission = () => {
      setPermissionState(notifications.getPermissionState());
    };
    refreshPermission();
    window.addEventListener('focus', refreshPermission);
    document.addEventListener('visibilitychange', refreshPermission);
    return () => {
      window.removeEventListener('focus', refreshPermission);
      document.removeEventListener('visibilitychange', refreshPermission);
    };
  }, [notifications]);

  const showNotifFeedback = (msg: string) => {
    setNotifFeedback(msg);
    if (notifFeedbackTimeoutRef.current !== null) {
      clearTimeout(notifFeedbackTimeoutRef.current);
    }
    notifFeedbackTimeoutRef.current = setTimeout(() => {
      notifFeedbackTimeoutRef.current = null;
      setNotifFeedback(null);
    }, 5000);
  };

  const handleTestSound = () => {
    sound.prepareForPlayback();
    sound.playChime(settings.soundVolume ?? 0.8);
  };

  const handleToggleNotifications = async (enable: boolean) => {
    if (!enable) {
      await updateSettings({ notificationsEnabled: false });
      setPermissionState(notifications.getPermissionState());
      onSaved();
      if (onUnsubscribePush) {
        await onUnsubscribePush();
      }
      return;
    }

    const currentPerm = notifications.getPermissionState();
    if (currentPerm === 'unsupported') {
      if (settings.notificationsEnabled) {
        await updateSettings({ notificationsEnabled: false });
      }
      showNotifFeedback('Notifications are not supported in this browser.');
      return;
    }

    if (currentPerm === 'denied') {
      if (settings.notificationsEnabled) {
        await updateSettings({ notificationsEnabled: false });
      }
      showNotifFeedback('Notifications are blocked in your browser site settings.');
      return;
    }

    if (currentPerm === 'granted') {
      await updateSettings({ notificationsEnabled: true });
      onSaved();
      if (isPushAuthenticated && onSyncPush) {
        const res = await onSyncPush();
        showNotifFeedback(
          res.ok
            ? 'Notifications & background lock-screen push enabled on this device.'
            : 'Foreground alerts enabled — background push could not connect yet.'
        );
      } else {
        showNotifFeedback('Notifications enabled for this device.');
      }
      return;
    }

    // Request permission from browser before turning the toggle on
    const granted = await notifications.requestPermission();
    const updatedPerm = notifications.getPermissionState();
    setPermissionState(updatedPerm);

    if (granted) {
      await updateSettings({ notificationsEnabled: true });
      onSaved();
      if (isPushAuthenticated && onSyncPush) {
        const res = await onSyncPush();
        showNotifFeedback(
          res.ok
            ? 'Notifications & background lock-screen push enabled on this device.'
            : 'Foreground alerts enabled — background push could not connect yet.'
        );
      } else {
        showNotifFeedback('Notifications enabled for this device.');
      }
    } else {
      if (settings.notificationsEnabled) {
        await updateSettings({ notificationsEnabled: false });
      }
      if (updatedPerm === 'denied') {
        showNotifFeedback('Notifications are blocked in your browser site settings.');
      } else {
        showNotifFeedback('Notification permission was not granted.');
      }
    }
  };

  const handleTestNotification = async () => {
    const currentPerm = notifications.getPermissionState();
    if (currentPerm === 'unsupported') {
      showNotifFeedback('On iPhone/iPad, use Share → Add to Home Screen to enable push notifications.');
      return;
    }

    let granted = currentPerm === 'granted';
    if (!granted) {
      granted = await notifications.requestPermission();
      const updatedPerm = notifications.getPermissionState();
      setPermissionState(updatedPerm);

      if (!granted) {
        showNotifFeedback(
          updatedPerm === 'denied'
            ? 'Blocked by browser — allow Notifications for this site in browser settings.'
            : 'Notification permission was not granted.'
        );
        return;
      }
    }

    if (!settings.notificationsEnabled) {
      updateSettings({ notificationsEnabled: true });
      onSaved();
    }

    if (isPushAuthenticated && onSyncPush) {
      void onSyncPush();
    }

    const { title, body } = getCompletionNotificationCopy('WORK');
    const sent = await notifications.notify(title, body, true, undefined, {
      silent: !settings.soundEnabled,
    });
    showNotifFeedback(sent ? 'Sample timer alert sent!' : 'Could not dispatch alert — check OS notification settings.');
  };

  const handleDelayedPushTest = async () => {
    if (!onScheduleTestPush || isSchedulingTestPush) return;
    setIsSchedulingTestPush(true);
    try {
      if (onSyncPush) {
        const syncRes = await onSyncPush();
        if (!syncRes.ok) {
          showNotifFeedback(
            syncRes.status === 'unconfigured' ||
              syncRes.reason === 'VAPID public key unavailable'
              ? 'Server push keys are not configured yet.'
              : 'Could not register this device for background push yet.'
          );
          return;
        }
      }
      const res = await onScheduleTestPush();
      if (res.scheduled) {
        showNotifFeedback('Push scheduled in 5s — lock your phone screen now to test lock-screen & watch alerts.');
      } else if (res.reason === 'rate_limited') {
        showNotifFeedback('Please wait a few seconds before sending another test push.');
      } else if (res.reason === 'missing_vapid_key') {
        showNotifFeedback('Server push keys are not configured yet.');
      } else {
        showNotifFeedback('Background push subscription not ready yet.');
      }
    } catch {
      showNotifFeedback('Could not schedule background test push.');
    } finally {
      setIsSchedulingTestPush(false);
    }
  };

  const getNotificationSubtitle = (): { text: string; className: string } => {
    if (notifFeedback) {
      return { text: notifFeedback, className: 'text-md-primary font-medium' };
    }
    if (permissionState === 'unsupported') {
      return {
        text: 'Requires Add to Home Screen on iOS, or a supported desktop/Android browser',
        className: 'text-amber-600 dark:text-amber-400',
      };
    }
    if (permissionState === 'denied') {
      return {
        text: 'Blocked in browser — enable Notifications in your browser site settings',
        className: 'text-rose-600 dark:text-rose-400',
      };
    }
    if (permissionState === 'granted' && settings.notificationsEnabled) {
      if (isPushAuthenticated && pushStatus === 'active') {
        return {
          text: 'Background Web Push active on this device — delivers on locked screens & watches',
          className: 'text-emerald-600 dark:text-emerald-400',
        };
      }
      if (!isPushAuthenticated) {
        return {
          text: 'Foreground alerts active on this device — sign in for lock-screen push',
          className: 'text-emerald-600 dark:text-emerald-400',
        };
      }
      if (pushStatus === 'unconfigured') {
        return {
          text: 'Permission granted — waiting for server push configuration',
          className: 'text-amber-600 dark:text-amber-400',
        };
      }
      if (pushStatus === 'error') {
        return {
          text: 'Background push failed to connect — foreground alerts remain active',
          className: 'text-amber-600 dark:text-amber-400',
        };
      }
      if (pushStatus === 'unsupported') {
        return {
          text: 'Background push unsupported here — foreground alerts active on this device',
          className: 'text-amber-600 dark:text-amber-400',
        };
      }
      return {
        text: 'Permission granted — connecting background push for this device…',
        className: 'text-md-on-surface-variant',
      };
    }
    if (permissionState === 'granted' && !settings.notificationsEnabled) {
      return {
        text: 'Permission granted — toggle switch on to enable alerts on this device',
        className: 'text-md-on-surface-variant',
      };
    }
    return {
      text: 'Push notifications for this device when intervals complete',
      className: 'text-md-on-surface-variant',
    };
  };

  const notifSubtitle = getNotificationSubtitle();

  return (
    <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-md-tertiary/10 text-md-tertiary flex items-center justify-center">
            <Volume2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-md-on-surface">Audio & Alerts</h3>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {/* Audio Chime */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-md-on-surface">Sound & Chime</div>
            <div className="text-xs text-md-on-surface-variant">
              Plays the in-app chime while open; mobile push follows your phone&apos;s sound/vibrate mode
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={handleTestSound}
              className="min-h-[44px] px-3.5 py-2 rounded-xl bg-md-surface-container hover:bg-md-surface-container-high text-xs font-semibold text-md-primary transition-colors shrink-0 flex items-center justify-center"
            >
              Test Chime
            </button>
            <Switch
              checked={settings.soundEnabled}
              onChange={(val) => {
                if (val) {
                  sound.prepareForPlayback();
                }
                updateSettings({ soundEnabled: val });
                onSaved();
              }}
            />
          </div>
        </div>

        {/* Sound Volume Slider */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-md-outline-variant/15 pt-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-md-on-surface">Chime Volume</div>
            <div className="text-xs text-md-on-surface-variant">
              Adjust in-app web chime volume (OS volume controls background notifications)
            </div>
          </div>
          <div className="flex items-center gap-3.5 w-full sm:w-auto shrink-0">
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={settings.soundVolume ?? 0.8}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                sound.prepareForPlayback();
                updateSettings({ soundVolume: Math.round(val * 100) / 100 });
              }}
              onMouseUp={onSaved}
              onTouchEnd={onSaved}
              onKeyUp={onSaved}
              className="flex-1 sm:w-48 md:w-60 h-2.5 rounded-full accent-md-primary cursor-pointer bg-md-surface-container-highest"
              aria-label="Chime Volume"
            />
            <span className="text-sm font-bold text-md-on-surface w-12 text-right tabular-nums shrink-0">
              {Math.round((settings.soundVolume ?? 0.8) * 100)}%
            </span>
          </div>
        </div>

        {/* Desktop / Push Notifications Toggle & Test */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-md-outline-variant/15 pt-4">
          <div className="flex items-start sm:items-center gap-2 min-w-0">
            <Bell className="w-4 h-4 text-md-on-surface-variant shrink-0 mt-0.5 sm:mt-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-md-on-surface">Notifications</div>
              <div className={`text-xs ${notifSubtitle.className}`}>{notifSubtitle.text}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {isPushAuthenticated &&
              permissionState === 'granted' &&
              settings.notificationsEnabled &&
              onScheduleTestPush && (
                <button
                  onClick={handleDelayedPushTest}
                  disabled={isSchedulingTestPush}
                  className="min-h-[44px] px-3.5 py-2 rounded-xl bg-md-surface-container hover:bg-md-surface-container-high text-xs font-semibold text-md-secondary transition-colors shrink-0 flex items-center justify-center disabled:opacity-60"
                  title="Send a server Web Push after 5 seconds so you can lock your phone to verify lock-screen and watch alerts"
                >
                  {isSchedulingTestPush ? 'Scheduling…' : 'Test Lock-Screen (5s)'}
                </button>
              )}
            <button
              onClick={handleTestNotification}
              className="min-h-[44px] px-3.5 py-2 rounded-xl bg-md-surface-container hover:bg-md-surface-container-high text-xs font-semibold text-md-primary transition-colors shrink-0 flex items-center justify-center"
            >
              Test Alert
            </button>
            <Switch
              checked={Boolean(settings.notificationsEnabled)}
              onChange={handleToggleNotifications}
            />
          </div>
        </div>
      </div>
    </Card>
  );
};
