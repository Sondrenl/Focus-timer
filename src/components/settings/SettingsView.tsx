import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Card } from '../ui/Card';
import { Switch } from '../ui/Switch';
import { Button } from '../ui/Button';
import { Clock, Volume2, Bell, RotateCcw, Check, Sparkles, Target } from 'lucide-react';
import { DEFAULT_SETTINGS } from '../../types/settings';

/**
 * Sanitizes a decimal string input to allow digits and at most one decimal point
 * with up to 2 decimal places (normalizing ',' to '.').
 */
function sanitizeDecimalInput(raw: string): string {
  const normalized = raw.replace(/,/g, '.');
  let result = '';
  let hasDot = false;
  let decimalsCount = 0;

  for (const ch of normalized) {
    if (ch >= '0' && ch <= '9') {
      if (hasDot) {
        if (decimalsCount < 2) {
          result += ch;
          decimalsCount += 1;
        }
      } else {
        result += ch;
      }
    } else if (ch === '.' && !hasDot) {
      hasDot = true;
      result += '.';
    }
  }
  return result;
}

export const SettingsView: React.FC = () => {
  const { settings, updateSettings, profile, updateProfile, sound, notifications } = useApp();
  const [savedToast, setSavedToast] = useState(false);

  // Local string draft states so the user can freely clear and type new numbers (including decimals) without snapping back mid-edit
  const [workInput, setWorkInput] = useState(() => String(settings.workDurationMinutes));
  const [shortBreakInput, setShortBreakInput] = useState(() => String(settings.shortBreakDurationMinutes));
  const [longBreakInput, setLongBreakInput] = useState(() => String(settings.longBreakDurationMinutes));
  const [intervalInput, setIntervalInput] = useState(() => String(settings.longBreakInterval));
  const [dailyGoalInput, setDailyGoalInput] = useState(() => String(profile.dailyGoalMinutes || 120));

  useEffect(() => {
    setWorkInput((prev) => {
      const parsedPrev = parseFloat(prev);
      if (!Number.isNaN(parsedPrev) && Math.abs(parsedPrev - settings.workDurationMinutes) < 1e-6) {
        return prev;
      }
      return String(settings.workDurationMinutes);
    });
  }, [settings.workDurationMinutes]);

  useEffect(() => {
    setShortBreakInput((prev) => {
      const parsedPrev = parseFloat(prev);
      if (!Number.isNaN(parsedPrev) && Math.abs(parsedPrev - settings.shortBreakDurationMinutes) < 1e-6) {
        return prev;
      }
      return String(settings.shortBreakDurationMinutes);
    });
  }, [settings.shortBreakDurationMinutes]);

  useEffect(() => {
    setLongBreakInput((prev) => {
      const parsedPrev = parseFloat(prev);
      if (!Number.isNaN(parsedPrev) && Math.abs(parsedPrev - settings.longBreakDurationMinutes) < 1e-6) {
        return prev;
      }
      return String(settings.longBreakDurationMinutes);
    });
  }, [settings.longBreakDurationMinutes]);

  useEffect(() => {
    setIntervalInput((prev) => {
      const parsedPrev = parseInt(prev, 10);
      if (!Number.isNaN(parsedPrev) && parsedPrev === settings.longBreakInterval) {
        return prev;
      }
      return String(settings.longBreakInterval);
    });
  }, [settings.longBreakInterval]);

  useEffect(() => {
    const goal = profile.dailyGoalMinutes || 120;
    setDailyGoalInput((prev) => {
      const parsedPrev = parseInt(prev, 10);
      if (!Number.isNaN(parsedPrev) && parsedPrev === goal) {
        return prev;
      }
      return String(goal);
    });
  }, [profile.dailyGoalMinutes]);

  const showSaved = () => {
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2000);
  };

  const handleDecimalDurationChange = (
    key: 'workDurationMinutes' | 'shortBreakDurationMinutes' | 'longBreakDurationMinutes',
    raw: string,
    setter: React.Dispatch<React.SetStateAction<string>>,
    maxVal: number
  ) => {
    const cleaned = sanitizeDecimalInput(raw);
    setter(cleaned);

    if (cleaned === '' || cleaned === '.' || cleaned.endsWith('.')) return;

    const parsed = parseFloat(cleaned);
    if (!Number.isNaN(parsed) && parsed > 0) {
      const clamped = Math.round(Math.min(maxVal, Math.max(0.01, parsed)) * 100) / 100;
      updateSettings({ [key]: clamped });
      showSaved();
    }
  };

  const handleDecimalDurationBlur = (
    key: 'workDurationMinutes' | 'shortBreakDurationMinutes' | 'longBreakDurationMinutes',
    currentRaw: string,
    setter: React.Dispatch<React.SetStateAction<string>>,
    maxVal: number,
    fallbackVal: number
  ) => {
    const parsed = parseFloat(currentRaw);
    const validNum =
      Number.isNaN(parsed) || parsed <= 0
        ? fallbackVal
        : Math.round(Math.min(maxVal, Math.max(0.01, parsed)) * 100) / 100;
    setter(String(validNum));
    if (settings[key] !== validNum) {
      updateSettings({ [key]: validNum });
      showSaved();
    }
  };

  const handleIntervalInputChange = (raw: string) => {
    const cleaned = raw.replace(/[^0-9]/g, '');
    setIntervalInput(cleaned);

    if (cleaned === '') return;

    const parsed = parseInt(cleaned, 10);
    if (!Number.isNaN(parsed) && parsed >= 1) {
      const clamped = Math.min(12, parsed);
      updateSettings({ longBreakInterval: clamped });
      showSaved();
    }
  };

  const handleIntervalInputBlur = () => {
    const parsed = parseInt(intervalInput, 10);
    const validNum = Number.isNaN(parsed) || parsed < 1 ? settings.longBreakInterval || 4 : Math.min(12, parsed);
    setIntervalInput(String(validNum));
    if (settings.longBreakInterval !== validNum) {
      updateSettings({ longBreakInterval: validNum });
      showSaved();
    }
  };

  const handleDailyGoalInputChange = (raw: string) => {
    const cleaned = raw.replace(/[^0-9]/g, '');
    setDailyGoalInput(cleaned);

    if (cleaned === '') return;

    const parsed = parseInt(cleaned, 10);
    if (!Number.isNaN(parsed) && parsed >= 1) {
      const clamped = Math.min(1440, parsed);
      updateProfile({ dailyGoalMinutes: clamped });
      showSaved();
    }
  };

  const handleDailyGoalInputBlur = () => {
    const parsed = parseInt(dailyGoalInput, 10);
    const validNum = Number.isNaN(parsed) || parsed < 1 ? 120 : Math.min(1440, parsed);
    setDailyGoalInput(String(validNum));
    if (profile.dailyGoalMinutes !== validNum) {
      updateProfile({ dailyGoalMinutes: validNum });
      showSaved();
    }
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
    setWorkInput(String(DEFAULT_SETTINGS.workDurationMinutes));
    setShortBreakInput(String(DEFAULT_SETTINGS.shortBreakDurationMinutes));
    setLongBreakInput(String(DEFAULT_SETTINGS.longBreakDurationMinutes));
    setIntervalInput(String(DEFAULT_SETTINGS.longBreakInterval));
    setDailyGoalInput('120');
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
                type="text"
                inputMode="decimal"
                value={workInput}
                onChange={(e) => handleDecimalDurationChange('workDurationMinutes', e.target.value, setWorkInput, 120)}
                onBlur={() => handleDecimalDurationBlur('workDurationMinutes', workInput, setWorkInput, 120, DEFAULT_SETTINGS.workDurationMinutes)}
                className="w-full px-3 py-2 text-base md:text-sm bg-md-surface-container-highest rounded-xl text-center font-bold text-md-on-surface border border-md-outline-variant/30 focus:border-md-primary focus:outline-none"
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
                type="text"
                inputMode="decimal"
                value={shortBreakInput}
                onChange={(e) => handleDecimalDurationChange('shortBreakDurationMinutes', e.target.value, setShortBreakInput, 60)}
                onBlur={() => handleDecimalDurationBlur('shortBreakDurationMinutes', shortBreakInput, setShortBreakInput, 60, DEFAULT_SETTINGS.shortBreakDurationMinutes)}
                className="w-full px-3 py-2 text-base md:text-sm bg-md-surface-container-highest rounded-xl text-center font-bold text-md-on-surface border border-md-outline-variant/30 focus:border-md-primary focus:outline-none"
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
                type="text"
                inputMode="decimal"
                value={longBreakInput}
                onChange={(e) => handleDecimalDurationChange('longBreakDurationMinutes', e.target.value, setLongBreakInput, 60)}
                onBlur={() => handleDecimalDurationBlur('longBreakDurationMinutes', longBreakInput, setLongBreakInput, 60, DEFAULT_SETTINGS.longBreakDurationMinutes)}
                className="w-full px-3 py-2 text-base md:text-sm bg-md-surface-container-highest rounded-xl text-center font-bold text-md-on-surface border border-md-outline-variant/30 focus:border-md-primary focus:outline-none"
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
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={intervalInput}
              onChange={(e) => handleIntervalInputChange(e.target.value)}
              onBlur={handleIntervalInputBlur}
              className="w-16 px-2.5 py-1.5 text-base md:text-sm bg-md-surface-container rounded-xl text-center font-bold text-md-on-surface border border-md-outline-variant/30 focus:border-md-primary focus:outline-none"
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
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={dailyGoalInput}
              onChange={(e) => handleDailyGoalInputChange(e.target.value)}
              onBlur={handleDailyGoalInputBlur}
              className="w-24 px-2.5 py-1.5 text-base md:text-sm bg-md-surface-container rounded-xl text-center font-bold text-md-on-surface border border-md-outline-variant/30 focus:border-md-primary focus:outline-none"
            />
            <span className="text-xs text-md-on-surface-variant">minutes ({((profile.dailyGoalMinutes || 120) / 60).toFixed(1)}h)</span>
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
            <button
              onClick={handleTestSound}
              className="px-3 py-1.5 rounded-xl bg-md-surface-container hover:bg-md-surface-container-high text-xs font-semibold text-md-primary transition-colors"
            >
              Test Chime
            </button>
          </div>

          {/* Desktop / Push Notifications Toggle */}
          <div className="flex items-center justify-between border-t border-md-outline-variant/15 pt-4">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-md-on-surface-variant" />
              <div>
                <div className="text-sm font-semibold text-md-on-surface">Desktop Notifications</div>
                <div className="text-xs text-md-on-surface-variant">Push notifications when intervals complete</div>
              </div>
            </div>
            <Switch
              checked={settings.notificationsEnabled && notifications.hasPermission()}
              onChange={handleToggleNotifications}
            />
          </div>
        </div>
      </Card>
    </div>
  );
};
