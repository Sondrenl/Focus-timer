import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Card } from '../ui/Card';
import { Switch } from '../ui/Switch';
import { Button } from '../ui/Button';
import { Clock, Volume2, Bell, RotateCcw, Check, Sparkles } from 'lucide-react';
import { DEFAULT_SETTINGS } from '../../types/settings';

export const SettingsView: React.FC = () => {
  const { settings, updateSettings, sound, notifications } = useApp();
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

  return (
    <div className="w-full max-w-3xl mx-auto py-6 px-4 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-md-on-surface">Settings & Preferences</h2>
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
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-md-primary/10 text-md-primary flex items-center justify-center">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-md-on-surface">Timer Intervals</h3>
            <p className="text-xs text-md-on-surface-variant">
              Configure session lengths in minutes
            </p>
          </div>
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
          <div>
            <div className="text-sm font-semibold text-md-on-surface">Long Break Interval</div>
            <div className="text-xs text-md-on-surface-variant">
              Number of Pomodoros before taking an extended rest
            </div>
          </div>
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

      {/* 2. Automation Switches */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-md-secondary/10 text-md-secondary flex items-center justify-center">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-md-on-surface">Flow & Automation</h3>
            <p className="text-xs text-md-on-surface-variant">
              Continuous session pacing preferences
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-md-on-surface">Auto-start Breaks</div>
              <div className="text-xs text-md-on-surface-variant">
                Automatically begin break countdown when a focus session completes
              </div>
            </div>
            <Switch
              checked={settings.autoStartBreaks}
              onChange={(val) => {
                updateSettings({ autoStartBreaks: val });
                showSaved();
              }}
            />
          </div>

          <div className="flex items-center justify-between border-t border-md-outline-variant/15 pt-4">
            <div>
              <div className="text-sm font-semibold text-md-on-surface">Auto-start Pomodoros</div>
              <div className="text-xs text-md-on-surface-variant">
                Automatically begin work interval when a break ends
              </div>
            </div>
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

      {/* 3. Audio & Notifications */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-md-tertiary/10 text-md-tertiary flex items-center justify-center">
            <Volume2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-md-on-surface">Audio & Alerts</h3>
            <p className="text-xs text-md-on-surface-variant">
              Sound cues and desktop notification permissions
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-md-on-surface">Completion Sound</div>
              <div className="text-xs text-md-on-surface-variant">
                Gentle Tibetan bowl chime when an interval finishes
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleTestSound}
                className="text-xs font-semibold text-md-primary hover:underline"
              >
                Test Sound
              </button>
              <Switch
                checked={settings.soundEnabled}
                onChange={(val) => {
                  updateSettings({ soundEnabled: val });
                  showSaved();
                }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-md-outline-variant/15 pt-4">
            <div>
              <div className="text-sm font-semibold text-md-on-surface">Desktop Notifications</div>
              <div className="text-xs text-md-on-surface-variant">
                Show system popup notification when backgrounded
              </div>
            </div>
            <Button
              variant={settings.notificationsEnabled ? 'tonal' : 'outlined'}
              size="sm"
              onClick={handleRequestNotifications}
            >
              <Bell className="w-3.5 h-3.5 mr-1.5" />
              <span>{settings.notificationsEnabled ? 'Enabled' : 'Enable'}</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* 4. Restore Defaults */}
      <div className="flex items-center justify-between pt-2">
        <span className="text-xs text-md-on-surface-variant">
          Reset preferences to their standard 25/5/25 presets
        </span>
        <Button
          variant="text"
          size="sm"
          onClick={handleResetDefaults}
          className="text-md-outline hover:text-md-on-surface"
        >
          <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
          <span>Reset Settings</span>
        </Button>
      </div>
    </div>
  );
};
