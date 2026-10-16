import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Card } from '../ui/Card';
import { Switch } from '../ui/Switch';
import { Button } from '../ui/Button';
import { Clock, Volume2, Bell, RotateCcw, Check, Sparkles, Target } from 'lucide-react';
import { DEFAULT_SETTINGS } from '../../types/settings';

export const SettingsView: React.FC = () => {
  const { settings, updateSettings, profile, updateProfile, sound, notifications } = useApp();
  const [savedToast, setSavedToast] = useState(false);

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

  const handleDailyGoalChange = (val: number) => {
    const num = Math.max(1, Math.min(1440, val));
    updateProfile({ dailyGoalMinutes: num });
    showSaved();
  };

  const handleTestSound = () => {
    sound.playChime(settings.soundVolume);
  };

  const handleToggleNotifications = async (enable: boolean) => {
    if (!enable) {
      updateSettings({ notificationsEnabled: false });
      showSaved();
      return;
    }
    const granted = await notifications.requestPermission();
    updateSettings({ notificationsEnabled: granted });
    if (granted) {
      notifications.notify('Notifications Enabled', 'Focus Timer will alert you when intervals complete!');
    }
    showSaved();
  };

  const handleResetDefaults = () => {
    updateSettings(DEFAULT_SETTINGS);
    updateProfile({ dailyGoalMinutes: 120 });
    showSaved();
  };

  return (
    <div className="w-full max-w-3xl mx-auto py-6 px-4 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-md-on-surface">Settings</h2>
        </div>

        {savedToast && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-xs font-semibold animate-in fade-in">
            <Check className="w-3.5 h-3.5" />
            <span>Preferences Saved</span>
          </div>
        )}
      </div>

      {/* 1. Timer Intervals Configuration */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-md-primary/10 text-md-primary flex items-center justify-center">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-md-on-surface">Timer Intervals</h3>
            </div>
          </div>

          {/* Prominent Restore Defaults Button */}
          <Button
            variant="tonal"
            size="sm"
            onClick={handleResetDefaults}
            className="text-xs font-semibold"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            <span>Restore Defaults</span>
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Work Duration */}
          <div className="flex flex-col gap-2 p-3.5 rounded-2xl bg-md-surface-container/60 border border-md-outline-variant/15">
            <label className="text-xs font-bold text-md-on-surface">
              Focus Duration
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="120"
                value={settings.workDurationMinutes}
                onChange={(e) => handleDurationChange('workDurationMinutes', parseInt(e.target.value) || 25)}
                className="w-full px-3 py-2 bg-md-surface-container-highest rounded-xl text-center font-bold text-md-on-surface border border-md-outline-variant/30 focus:border-md-primary focus:outline-none"
              />
              <span className="text-xs font-semibold text-md-on-surface-variant">min</span>
            </div>
          </div>

          {/* Short Break */}
          <div className="flex flex-col gap-2 p-3.5 rounded-2xl bg-md-surface-container/60 border border-md-outline-variant/15">
            <label className="text-xs font-bold text-md-on-surface">
              Short Break
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="60"
                value={settings.shortBreakDurationMinutes}
                onChange={(e) => handleDurationChange('shortBreakDurationMinutes', parseInt(e.target.value) || 5)}
                className="w-full px-3 py-2 bg-md-surface-container-highest rounded-xl text-center font-bold text-md-on-surface border border-md-outline-variant/30 focus:border-md-primary focus:outline-none"
              />
              <span className="text-xs font-semibold text-md-on-surface-variant">min</span>
            </div>
          </div>

          {/* Long Break */}
          <div className="flex flex-col gap-2 p-3.5 rounded-2xl bg-md-surface-container/60 border border-md-outline-variant/15">
            <label className="text-xs font-bold text-md-on-surface">
              Long Break
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="60"
                value={settings.longBreakDurationMinutes}
                onChange={(e) => handleDurationChange('longBreakDurationMinutes', parseInt(e.target.value) || 25)}
                className="w-full px-3 py-2 bg-md-surface-container-highest rounded-xl text-center font-bold text-md-on-surface border border-md-outline-variant/30 focus:border-md-primary focus:outline-none"
              />
              <span className="text-xs font-semibold text-md-on-surface-variant">min</span>
            </div>
          </div>
        </div>

        {/* Long Break Interval */}
        <div className="flex items-center justify-between pt-2 border-t border-md-outline-variant/15">
          <div className="text-sm font-semibold text-md-on-surface">Long Break Interval</div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              max="12"
              value={settings.longBreakInterval}
              onChange={(e) => handleDurationChange('longBreakInterval', parseInt(e.target.value) || 4)}
              className="w-16 px-2.5 py-1.5 bg-md-surface-container rounded-xl text-center font-bold text-md-on-surface border border-md-outline-variant/30 focus:border-md-primary focus:outline-none"
            />
            <span className="text-xs text-md-on-surface-variant">cycles</span>
          </div>
        </div>
      </Card>

      {/* 2. Daily Goal Configuration */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
            <Target className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-md-on-surface">Daily Focus Goal</h3>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="text-sm font-semibold text-md-on-surface">Target Time per Day</div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="15"
              max="1440"
              step="15"
              value={profile.dailyGoalMinutes || 120}
              onChange={(e) => handleDailyGoalChange(parseInt(e.target.value) || 120)}
              className="w-24 px-2.5 py-1.5 bg-md-surface-container rounded-xl text-center font-bold text-md-on-surface border border-md-outline-variant/30 focus:border-md-primary focus:outline-none"
            />
            <span className="text-xs text-md-on-surface-variant">minutes ({(profile.dailyGoalMinutes / 60).toFixed(1)}h)</span>
          </div>
        </div>
      </Card>

      {/* 3. Flow (Automation Switches) */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-md-secondary/10 text-md-secondary flex items-center justify-center">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-md-on-surface">Flow</h3>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-md-on-surface">Auto-start Breaks</div>
            <Switch
              checked={settings.autoStartBreaks}
              onChange={(val) => {
                updateSettings({ autoStartBreaks: val });
                showSaved();
              }}
            />
          </div>

          <div className="flex items-center justify-between border-t border-md-outline-variant/15 pt-4">
            <div className="text-sm font-semibold text-md-on-surface">Auto-start Pomodoros</div>
            <Switch
              checked={settings.autoStartPomodoros}
              onChange={(val) => {
                updateSettings({ autoStartPomodoros: val });
                showSaved();
              }}
            />
          </div>
        </div>
      </Card>

      {/* 4. Audio & Alerts */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-md-tertiary/10 text-md-tertiary flex items-center justify-center">
            <Volume2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-md-on-surface">Audio & Alerts</h3>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {/* Audio Chime */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-md-on-surface">Chime Alert</div>
              <div className="text-xs text-md-on-surface-variant">Play gentle acoustic sound on completion</div>
            </div>
            <button
              onClick={handleTestSound}
              className="px-3 py-1.5 rounded-xl bg-md-surface-container hover:bg-md-surface-container-high text-xs font-semibold text-md-primary transition-colors"
            >
              Test Chime
            </button>
          </div>

          {/* Desktop Notifications Toggle */}
          <div className="flex items-center justify-between border-t border-md-outline-variant/15 pt-4">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-md-on-surface-variant" />
              <div>
                <div className="text-sm font-semibold text-md-on-surface">Desktop Notifications</div>
                <div className="text-xs text-md-on-surface-variant">Push notifications when intervals complete</div>
              </div>
            </div>
            <Switch
              checked={settings.notificationsEnabled}
              onChange={handleToggleNotifications}
            />
          </div>
        </div>
      </Card>
    </div>
  );
};
