import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Card } from '../ui/Card';
import { Switch } from '../ui/Switch';
import { Button } from '../ui/Button';
import { Clock, Volume2, Bell, RotateCcw, Check, Sparkles } from 'lucide-react';
import { DEFAULT_SETTINGS } from '../../types/settings';

export const SettingsView: React.FC = () => {
  const { settings, updateSettings, sound, notifications, clearSessions } = useApp();
  const [savedToast, setSavedToast] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);

  const showSaved = () => {
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2000);
  };

  const handleDurationChange = (
    key: 'workDurationMinutes' | 'shortBreakDurationMinutes' | 'longBreakDurationMinutes' | 'longBreakInterval',
    val: number
  ) => {
    const num = Math.max(1, Math.min(120, val));
    updateSettings({ [key]: num });
    showSaved();
  };

  const handleTestSound = () => {
    sound.playChime(settings.soundVolume);
  };

  const handleRequestNotifications = async () => {
    const granted = await notifications.requestPermission();
    updateSettings({ notificationsEnabled: granted });
    if (granted) {
      notifications.notify('Notifications Enabled', 'Pomodor will alert you when intervals complete!');
    }
  };

  const handleResetDefaults = () => {
    updateSettings(DEFAULT_SETTINGS);
    showSaved();
  };

  const handleClearSessions = async () => {
    await clearSessions();
    setResetConfirm(false);
    showSaved();
  };

  return (
    <div className="w-full max-w-3xl mx-auto py-6 px-4 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-md-on-surface">Settings & Preferences</h2>
          <p className="text-xs text-md-on-surface-variant mt-0.5">
            Customize intervals, sound notifications, and automatic cycle transitions.
          </p>
        </div>

        {savedToast && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-md-primary-container text-md-on-primary-container text-xs font-semibold animate-in fade-in duration-200">
            <Check className="w-3.5 h-3.5" />
            <span>Saved</span>
          </div>
        )}
      </div>

      {/* 1. Interval Durations Section */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20 flex flex-col gap-5">
        <div className="flex items-center gap-2.5 pb-2 border-b border-md-outline-variant/20">
          <Clock className="w-5 h-5 text-md-primary" />
          <h3 className="text-base font-bold text-md-on-surface">Interval Durations</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Work Duration */}
          <div className="flex flex-col gap-1.5 p-3.5 rounded-2xl bg-md-surface-container">
            <label className="text-xs font-bold text-md-on-surface">
              Pomodoro Focus Duration
            </label>
            <div className="flex items-center gap-3 mt-1">
              <input
                type="number"
                min="1"
                max="120"
                value={settings.workDurationMinutes}
                onChange={(e) => handleDurationChange('workDurationMinutes', parseInt(e.target.value) || 25)}
                className="w-20 px-3 py-1.5 text-center font-bold text-base bg-md-surface-container-high rounded-xl border border-md-outline-variant/40 focus:outline-none focus:border-md-primary"
              />
              <span className="text-xs text-md-on-surface-variant font-medium">minutes</span>
            </div>
          </div>

          {/* Short Break Duration */}
          <div className="flex flex-col gap-1.5 p-3.5 rounded-2xl bg-md-surface-container">
            <label className="text-xs font-bold text-md-on-surface">
              Short Break Duration
            </label>
            <div className="flex items-center gap-3 mt-1">
              <input
                type="number"
                min="1"
                max="60"
                value={settings.shortBreakDurationMinutes}
                onChange={(e) => handleDurationChange('shortBreakDurationMinutes', parseInt(e.target.value) || 5)}
                className="w-20 px-3 py-1.5 text-center font-bold text-base bg-md-surface-container-high rounded-xl border border-md-outline-variant/40 focus:outline-none focus:border-md-primary"
              />
              <span className="text-xs text-md-on-surface-variant font-medium">minutes</span>
            </div>
          </div>

          {/* Long Break Duration */}
          <div className="flex flex-col gap-1.5 p-3.5 rounded-2xl bg-md-surface-container">
            <label className="text-xs font-bold text-md-on-surface">
              Long Break Duration
            </label>
            <div className="flex items-center gap-3 mt-1">
              <input
                type="number"
                min="1"
                max="90"
                value={settings.longBreakDurationMinutes}
                onChange={(e) => handleDurationChange('longBreakDurationMinutes', parseInt(e.target.value) || 25)}
                className="w-20 px-3 py-1.5 text-center font-bold text-base bg-md-surface-container-high rounded-xl border border-md-outline-variant/40 focus:outline-none focus:border-md-primary"
              />
              <span className="text-xs text-md-on-surface-variant font-medium">minutes</span>
            </div>
          </div>

          {/* Long Break Cycle Interval */}
          <div className="flex flex-col gap-1.5 p-3.5 rounded-2xl bg-md-surface-container">
            <label className="text-xs font-bold text-md-on-surface">
              Long Break Cycle Interval
            </label>
            <div className="flex items-center gap-3 mt-1">
              <input
                type="number"
                min="1"
                max="12"
                value={settings.longBreakInterval}
                onChange={(e) => handleDurationChange('longBreakInterval', parseInt(e.target.value) || 4)}
                className="w-20 px-3 py-1.5 text-center font-bold text-base bg-md-surface-container-high rounded-xl border border-md-outline-variant/40 focus:outline-none focus:border-md-primary"
              />
              <span className="text-xs text-md-on-surface-variant font-medium">sessions</span>
            </div>
          </div>
        </div>
      </Card>

      {/* 2. Automation & Transitions */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20 flex flex-col gap-4">
        <div className="flex items-center gap-2.5 pb-2 border-b border-md-outline-variant/20">
          <Sparkles className="w-5 h-5 text-md-primary" />
          <h3 className="text-base font-bold text-md-on-surface">Transitions & Automation</h3>
        </div>

        <Switch
          checked={settings.autoStartBreaks}
          onChange={(checked) => {
            updateSettings({ autoStartBreaks: checked });
            showSaved();
          }}
          label="Auto-start Breaks"
          description="Automatically trigger break countdown when a focus session concludes"
        />

        <div className="border-t border-md-outline-variant/20" />

        <Switch
          checked={settings.autoStartPomodoros}
          onChange={(checked) => {
            updateSettings({ autoStartPomodoros: checked });
            showSaved();
          }}
          label="Auto-start Focus Sessions"
          description="Automatically start the next focus interval when break time finishes"
        />
      </Card>

      {/* 3. Audio & Notifications */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20 flex flex-col gap-4">
        <div className="flex items-center gap-2.5 pb-2 border-b border-md-outline-variant/20">
          <Volume2 className="w-5 h-5 text-md-primary" />
          <h3 className="text-base font-bold text-md-on-surface">Audio Chimes & Alerts</h3>
        </div>

        <Switch
          checked={settings.soundEnabled}
          onChange={(checked) => {
            updateSettings({ soundEnabled: checked });
            showSaved();
          }}
          label="Sound Chime Feedback"
          description="Plays synthesized harmonic chime upon interval completion"
        />

        {settings.soundEnabled && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-3.5 bg-md-surface-container rounded-2xl">
            <div className="flex flex-col">
              <span className="text-xs font-bold text-md-on-surface">Volume Level</span>
              <span className="text-[11px] text-md-on-surface-variant">
                Adjust chime loudness ({Math.round(settings.soundVolume * 100)}%)
              </span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={settings.soundVolume}
                onChange={(e) => {
                  updateSettings({ soundVolume: parseFloat(e.target.value) });
                }}
                className="w-32 accent-md-primary cursor-pointer"
              />
              <Button size="sm" variant="tonal" onClick={handleTestSound}>
                Test Sound
              </Button>
            </div>
          </div>
        )}

        <div className="border-t border-md-outline-variant/20" />

        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-3">
            <Bell className="w-5 h-5 text-md-outline" />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-md-on-surface">Desktop Notifications</span>
              <span className="text-xs text-md-on-surface-variant">
                Alerts when browser tab is running in the background
              </span>
            </div>
          </div>
          {notifications.hasPermission() ? (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
              Enabled
            </span>
          ) : (
            <Button size="sm" variant="tonal" onClick={handleRequestNotifications}>
              Allow Notifications
            </Button>
          )}
        </div>
      </Card>

      {/* 4. Danger Zone & Reset */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-sm font-bold text-md-on-surface">Reset Settings</span>
            <span className="text-xs text-md-on-surface-variant">Restore default durations (25/5/25)</span>
          </div>
          <Button variant="outlined" size="sm" onClick={handleResetDefaults}>
            <RotateCcw className="w-3.5 h-3.5 mr-1" />
            Reset to Defaults
          </Button>
        </div>

        <div className="border-t border-md-outline-variant/20" />

        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-sm font-bold text-md-error">Clear Session History</span>
            <span className="text-xs text-md-on-surface-variant">Erase completed focus session logs and reset statistics</span>
          </div>
          {resetConfirm ? (
            <div className="flex items-center gap-2">
              <button
                onClick={handleClearSessions}
                className="px-3 py-1.5 rounded-full text-xs font-bold bg-md-error text-md-on-error hover:bg-red-700 transition-colors"
              >
                Yes, Clear
              </button>
              <button
                onClick={() => setResetConfirm(false)}
                className="px-2 py-1.5 rounded-full text-xs text-md-on-surface-variant hover:bg-md-surface-container"
              >
                Cancel
              </button>
            </div>
          ) : (
            <Button variant="outlined" size="sm" onClick={() => setResetConfirm(true)} className="border-md-error text-md-error hover:bg-md-error/5">
              Clear History
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
};
