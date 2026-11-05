import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Switch } from '../ui/Switch';
import { Volume2, Bell } from 'lucide-react';
import { UserSettings } from '../../types/settings';
import { SoundService } from '../../services/audio/SoundService';
import {
  NotificationService,
  NotificationPermissionStatus,
} from '../../services/notification/NotificationService';

interface SoundNotificationSectionProps {
  settings: UserSettings;
  updateSettings: (updates: Partial<UserSettings>) => void;
  sound: SoundService;
  notifications: NotificationService;
  onSaved: () => void;
}

export const SoundNotificationSection: React.FC<SoundNotificationSectionProps> = ({
  settings,
  updateSettings,
  sound,
  notifications,
  onSaved,
}) => {
  const [permissionState, setPermissionState] = useState<NotificationPermissionStatus>(() =>
    notifications.getPermissionState()
  );
  const [notifFeedback, setNotifFeedback] = useState<string | null>(null);

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
    setTimeout(() => setNotifFeedback(null), 4000);
  };

  const handleTestSound = () => {
    sound.playChime(settings.soundVolume);
  };

  const handleToggleNotifications = async (enable: boolean) => {
    if (!enable) {
      updateSettings({ notificationsEnabled: false });
      setPermissionState(notifications.getPermissionState());
      onSaved();
      return;
    }

    const currentPerm = notifications.getPermissionState();
    if (currentPerm === 'granted') {
      updateSettings({ notificationsEnabled: true });
      onSaved();
      return;
    }

    const granted = await notifications.requestPermission();
    const updatedPerm = notifications.getPermissionState();
    setPermissionState(updatedPerm);
    updateSettings({ notificationsEnabled: granted });

    if (granted) {
      showNotifFeedback('Notifications enabled for this device.');
    } else if (updatedPerm === 'denied') {
      showNotifFeedback('Notifications are blocked in your browser site settings.');
    } else if (updatedPerm === 'unsupported') {
      showNotifFeedback('On iPhone/iPad, use Share → Add to Home Screen to enable notifications.');
    }
    onSaved();
  };

  const handleTestNotification = async () => {
    const currentPerm = notifications.getPermissionState();
    if (currentPerm === 'unsupported') {
      showNotifFeedback('On iPhone/iPad, use Share → Add to Home Screen to enable push notifications.');
      return;
    }

    const granted = await notifications.requestPermission();
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

    if (!settings.notificationsEnabled) {
      updateSettings({ notificationsEnabled: true });
    }

    const sent = await notifications.notify(
      'Pomodor — Focus session complete',
      'Your focus timer has finished. Time for a break.',
      true
    );
    showNotifFeedback(sent ? 'Sample timer alert sent!' : 'Could not dispatch alert — check OS notification settings.');
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
      return {
        text: 'Permission granted — alerts active on this device',
        className: 'text-emerald-600 dark:text-emerald-400',
      };
    }
    if (permissionState === 'granted' && !settings.notificationsEnabled) {
      return {
        text: 'Permission granted — toggle switch on to receive alerts',
        className: 'text-md-on-surface-variant',
      };
    }
    return {
      text: 'Push notifications when intervals complete',
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
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-md-on-surface">Chime Alert</div>
            <div className="text-xs text-md-on-surface-variant">Play gentle acoustic sound on completion</div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={handleTestSound}
              className="px-3 py-1.5 rounded-xl bg-md-surface-container hover:bg-md-surface-container-high text-xs font-semibold text-md-primary transition-colors shrink-0"
            >
              Test Chime
            </button>
            <Switch
              checked={settings.soundEnabled}
              onChange={(val) => {
                updateSettings({ soundEnabled: val });
                onSaved();
              }}
            />
          </div>
        </div>

        {/* Sound Volume Slider */}
        <div className="flex items-center justify-between gap-4 border-t border-md-outline-variant/15 pt-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-md-on-surface">Chime Volume</div>
            <div className="text-xs text-md-on-surface-variant">Adjust completion bell volume</div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={settings.soundVolume ?? 0.8}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                updateSettings({ soundVolume: Math.round(val * 100) / 100 });
              }}
              className="w-28 md:w-36 accent-md-primary cursor-pointer"
            />
            <span className="text-xs font-semibold text-md-on-surface-variant w-8 text-right">
              {Math.round((settings.soundVolume ?? 0.8) * 100)}%
            </span>
          </div>
        </div>

        {/* Desktop / Push Notifications Toggle & Test */}
        <div className="flex items-center justify-between gap-3 border-t border-md-outline-variant/15 pt-4">
          <div className="flex items-center gap-2 min-w-0">
            <Bell className="w-4 h-4 text-md-on-surface-variant shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-md-on-surface">Notifications</div>
              <div className={`text-xs ${notifSubtitle.className}`}>{notifSubtitle.text}</div>
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={handleTestNotification}
              className="px-3 py-1.5 rounded-xl bg-md-surface-container hover:bg-md-surface-container-high text-xs font-semibold text-md-primary transition-colors"
            >
              Test Alert
            </button>
            <Switch
              checked={settings.notificationsEnabled && permissionState === 'granted'}
              onChange={handleToggleNotifications}
            />
          </div>
        </div>
      </div>
    </Card>
  );
};
