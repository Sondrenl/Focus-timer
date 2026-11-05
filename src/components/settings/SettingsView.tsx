import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Check } from 'lucide-react';
import { DEFAULT_SETTINGS } from '../../types/settings';
import { TimerDurationSection, FocusedDurationField } from './TimerDurationSection';
import { AutomationSection } from './AutomationSection';
import { SoundNotificationSection } from './SoundNotificationSection';

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

  // Focus tracking to prevent draft inputs from snapping back or clobbering while actively typing
  const [focusedField, setFocusedField] = useState<FocusedDurationField>(null);

  // Local string draft states so the user can freely clear and type new numbers (including decimals) without snapping back mid-edit
  const [workInput, setWorkInput] = useState(() => String(settings.workDurationMinutes));
  const [shortBreakInput, setShortBreakInput] = useState(() => String(settings.shortBreakDurationMinutes));
  const [longBreakInput, setLongBreakInput] = useState(() => String(settings.longBreakDurationMinutes));
  const [intervalInput, setIntervalInput] = useState(() => String(settings.longBreakInterval));
  const [dailyGoalInput, setDailyGoalInput] = useState(() => String(profile.dailyGoalMinutes || 120));

  useEffect(() => {
    if (focusedField === 'work') return;
    setWorkInput((prev) => {
      const parsedPrev = parseFloat(prev);
      if (!Number.isNaN(parsedPrev) && Math.abs(parsedPrev - settings.workDurationMinutes) < 1e-6) {
        return prev;
      }
      return String(settings.workDurationMinutes);
    });
  }, [settings.workDurationMinutes, focusedField]);

  useEffect(() => {
    if (focusedField === 'shortBreak') return;
    setShortBreakInput((prev) => {
      const parsedPrev = parseFloat(prev);
      if (!Number.isNaN(parsedPrev) && Math.abs(parsedPrev - settings.shortBreakDurationMinutes) < 1e-6) {
        return prev;
      }
      return String(settings.shortBreakDurationMinutes);
    });
  }, [settings.shortBreakDurationMinutes, focusedField]);

  useEffect(() => {
    if (focusedField === 'longBreak') return;
    setLongBreakInput((prev) => {
      const parsedPrev = parseFloat(prev);
      if (!Number.isNaN(parsedPrev) && Math.abs(parsedPrev - settings.longBreakDurationMinutes) < 1e-6) {
        return prev;
      }
      return String(settings.longBreakDurationMinutes);
    });
  }, [settings.longBreakDurationMinutes, focusedField]);

  useEffect(() => {
    if (focusedField === 'interval') return;
    setIntervalInput((prev) => {
      const parsedPrev = parseInt(prev, 10);
      if (!Number.isNaN(parsedPrev) && parsedPrev === settings.longBreakInterval) {
        return prev;
      }
      return String(settings.longBreakInterval);
    });
  }, [settings.longBreakInterval, focusedField]);

  useEffect(() => {
    if (focusedField === 'dailyGoal') return;
    const goal = profile.dailyGoalMinutes || 120;
    setDailyGoalInput((prev) => {
      const parsedPrev = parseInt(prev, 10);
      if (!Number.isNaN(parsedPrev) && parsedPrev === goal) {
        return prev;
      }
      return String(goal);
    });
  }, [profile.dailyGoalMinutes, focusedField]);

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
    const validNum = Number.isNaN(parsed) || parsed < 1 ? profile.dailyGoalMinutes || 120 : Math.min(1440, parsed);
    setDailyGoalInput(String(validNum));
    if (profile.dailyGoalMinutes !== validNum) {
      updateProfile({ dailyGoalMinutes: validNum });
      showSaved();
    }
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

      <TimerDurationSection
        settings={settings}
        dailyGoalMinutes={profile.dailyGoalMinutes || 120}
        workInput={workInput}
        setWorkInput={setWorkInput}
        shortBreakInput={shortBreakInput}
        setShortBreakInput={setShortBreakInput}
        longBreakInput={longBreakInput}
        setLongBreakInput={setLongBreakInput}
        intervalInput={intervalInput}
        dailyGoalInput={dailyGoalInput}
        setFocusedField={setFocusedField}
        onDecimalDurationChange={handleDecimalDurationChange}
        onDecimalDurationBlur={handleDecimalDurationBlur}
        onIntervalInputChange={handleIntervalInputChange}
        onIntervalInputBlur={handleIntervalInputBlur}
        onDailyGoalInputChange={handleDailyGoalInputChange}
        onDailyGoalInputBlur={handleDailyGoalInputBlur}
        onResetDefaults={handleResetDefaults}
      />

      <AutomationSection
        settings={settings}
        updateSettings={updateSettings}
        onSaved={showSaved}
      />

      <SoundNotificationSection
        settings={settings}
        updateSettings={updateSettings}
        sound={sound}
        notifications={notifications}
        onSaved={showSaved}
      />
    </div>
  );
};
