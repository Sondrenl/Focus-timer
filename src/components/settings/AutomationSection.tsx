import React from 'react';
import { Card } from '../ui/Card';
import { Switch } from '../ui/Switch';
import { Sparkles } from 'lucide-react';
import { UserSettings } from '../../types/settings';

interface AutomationSectionProps {
  settings: UserSettings;
  updateSettings: (updates: Partial<UserSettings>) => void;
  onSaved: () => void;
}

export const AutomationSection: React.FC<AutomationSectionProps> = ({
  settings,
  updateSettings,
  onSaved,
}) => {
  return (
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
              onSaved();
            }}
          />
        </div>

        <div className="flex items-center justify-between border-t border-md-outline-variant/15 pt-4">
          <div className="text-sm font-semibold text-md-on-surface">Auto-start Pomodoros</div>
          <Switch
            checked={settings.autoStartPomodoros}
            onChange={(val) => {
              updateSettings({ autoStartPomodoros: val });
              onSaved();
            }}
          />
        </div>
      </div>
    </Card>
  );
};
