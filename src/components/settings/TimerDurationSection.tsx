import React from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Clock, RotateCcw, Target } from 'lucide-react';
import { UserSettings, DEFAULT_SETTINGS } from '../../types/settings';

export type FocusedDurationField = 'work' | 'shortBreak' | 'longBreak' | 'interval' | 'dailyGoal' | null;

interface TimerDurationSectionProps {
  settings: UserSettings;
  dailyGoalMinutes: number;
  workInput: string;
  setWorkInput: React.Dispatch<React.SetStateAction<string>>;
  shortBreakInput: string;
  setShortBreakInput: React.Dispatch<React.SetStateAction<string>>;
  longBreakInput: string;
  setLongBreakInput: React.Dispatch<React.SetStateAction<string>>;
  intervalInput: string;
  dailyGoalInput: string;
  setFocusedField: React.Dispatch<React.SetStateAction<FocusedDurationField>>;
  onDecimalDurationChange: (
    key: 'workDurationMinutes' | 'shortBreakDurationMinutes' | 'longBreakDurationMinutes',
    raw: string,
    setter: React.Dispatch<React.SetStateAction<string>>,
    maxVal: number
  ) => void;
  onDecimalDurationBlur: (
    key: 'workDurationMinutes' | 'shortBreakDurationMinutes' | 'longBreakDurationMinutes',
    currentRaw: string,
    setter: React.Dispatch<React.SetStateAction<string>>,
    maxVal: number,
    fallbackVal: number
  ) => void;
  onIntervalInputChange: (raw: string) => void;
  onIntervalInputBlur: () => void;
  onDailyGoalInputChange: (raw: string) => void;
  onDailyGoalInputBlur: () => void;
  onResetDefaults: () => void;
}

export const TimerDurationSection: React.FC<TimerDurationSectionProps> = ({
  settings,
  dailyGoalMinutes,
  workInput,
  setWorkInput,
  shortBreakInput,
  setShortBreakInput,
  longBreakInput,
  setLongBreakInput,
  intervalInput,
  dailyGoalInput,
  setFocusedField,
  onDecimalDurationChange,
  onDecimalDurationBlur,
  onIntervalInputChange,
  onIntervalInputBlur,
  onDailyGoalInputChange,
  onDailyGoalInputBlur,
  onResetDefaults,
}) => {
  const durationFields = [
    {
      key: 'workDurationMinutes' as const,
      label: 'Focus Duration',
      value: workInput,
      setter: setWorkInput,
      fieldId: 'work' as const,
      maxVal: 120,
      fallback: settings.workDurationMinutes || DEFAULT_SETTINGS.workDurationMinutes,
    },
    {
      key: 'shortBreakDurationMinutes' as const,
      label: 'Short Break',
      value: shortBreakInput,
      setter: setShortBreakInput,
      fieldId: 'shortBreak' as const,
      maxVal: 60,
      fallback: settings.shortBreakDurationMinutes || DEFAULT_SETTINGS.shortBreakDurationMinutes,
    },
    {
      key: 'longBreakDurationMinutes' as const,
      label: 'Long Break',
      value: longBreakInput,
      setter: setLongBreakInput,
      fieldId: 'longBreak' as const,
      maxVal: 60,
      fallback: settings.longBreakDurationMinutes || DEFAULT_SETTINGS.longBreakDurationMinutes,
    },
  ];

  return (
    <>
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

          <Button
            variant="tonal"
            size="sm"
            onClick={onResetDefaults}
            className="text-xs font-semibold"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            <span>Restore Defaults</span>
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {durationFields.map((df) => (
            <div key={df.key} className="flex flex-col gap-2 p-3.5 rounded-2xl bg-md-surface-container/60 border border-md-outline-variant/15">
              <label className="text-xs font-bold text-md-on-surface">
                {df.label}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={df.value}
                  onFocus={() => setFocusedField(df.fieldId)}
                  onChange={(e) => onDecimalDurationChange(df.key, e.target.value, df.setter, df.maxVal)}
                  onBlur={() => {
                    setFocusedField(null);
                    onDecimalDurationBlur(df.key, df.value, df.setter, df.maxVal, df.fallback);
                  }}
                  className="w-full px-3 py-2 text-base md:text-sm bg-md-surface-container-highest rounded-xl text-center font-bold text-md-on-surface border border-md-outline-variant/30 focus:border-md-primary focus:outline-none"
                />
                <span className="text-xs font-semibold text-md-on-surface-variant">min</span>
              </div>
            </div>
          ))}
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
              onFocus={() => setFocusedField('interval')}
              onChange={(e) => onIntervalInputChange(e.target.value)}
              onBlur={() => {
                setFocusedField(null);
                onIntervalInputBlur();
              }}
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
              onFocus={() => setFocusedField('dailyGoal')}
              onChange={(e) => onDailyGoalInputChange(e.target.value)}
              onBlur={() => {
                setFocusedField(null);
                onDailyGoalInputBlur();
              }}
              className="w-24 px-2.5 py-1.5 text-base md:text-sm bg-md-surface-container rounded-xl text-center font-bold text-md-on-surface border border-md-outline-variant/30 focus:border-md-primary focus:outline-none"
            />
            <span className="text-xs text-md-on-surface-variant">
              minutes ({((dailyGoalMinutes || 120) / 60).toFixed(1)}h)
            </span>
          </div>
        </div>
      </Card>
    </>
  );
};
