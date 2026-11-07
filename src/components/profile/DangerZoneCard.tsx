import React, { useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { AlertTriangle, Trash2, RotateCcw } from 'lucide-react';
import { CompletedSession } from '../../types/session';
import { Tag } from '../../types/tag';
import { CoffeeCup } from '../../types/coffee';
import { UserProfile } from '../../types/user';

interface DangerZoneCardProps {
  sessions: CompletedSession[];
  tags: Tag[];
  coffeeCups: CoffeeCup[];
  profile: UserProfile;
  isAuthenticated: boolean;
  resetAllData: (scope: 'sessions-only' | 'factory-reset') => Promise<void>;
  onStatusMessage: (msg: string | null) => void;
  onErrorMessage: (msg: string | null) => void;
}

export const DangerZoneCard: React.FC<DangerZoneCardProps> = ({
  sessions,
  tags,
  coffeeCups,
  profile,
  isAuthenticated,
  resetAllData,
  onStatusMessage,
  onErrorMessage,
}) => {
  const [resetModalScope, setResetModalScope] = useState<'sessions-only' | 'factory-reset' | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  const handleConfirmReset = async () => {
    if (!resetModalScope || isResetting) return;
    const scope = resetModalScope;
    setIsResetting(true);
    try {
      await resetAllData(scope);
      setResetModalScope(null);
      onStatusMessage(
        scope === 'sessions-only'
          ? 'Focus and coffee history permanently cleared.'
          : 'Factory reset complete! All data has been reset to defaults.'
      );
      setTimeout(() => onStatusMessage(null), 4000);
    } catch {
      onErrorMessage('An error occurred while resetting data.');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <>
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-error/25 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-md-error/10 text-md-error flex items-center justify-center">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-md-error">Danger Zone</h3>
            <p className="text-xs text-md-on-surface-variant">Irreversible actions for resetting your data</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-md-outline-variant/15">
          {/* Card 1: Clear History Only */}
          <div className="p-4 rounded-2xl bg-md-surface-container/60 border border-md-outline-variant/20 flex flex-col justify-between gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-md-error" />
                <span className="text-sm font-bold text-md-on-surface">Clear Focus & Coffee History</span>
              </div>
              <p className="text-xs text-md-on-surface-variant leading-relaxed">
                Permanently wipes all completed sessions and logged coffee cups. Custom tags, daily goals, and timer preferences are completely preserved.
              </p>
            </div>
            <Button
              variant="outlined"
              size="sm"
              className="border-md-error/40 text-md-error hover:bg-md-error/10 justify-center w-full mt-2 font-semibold"
              onClick={() => setResetModalScope('sessions-only')}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              <span>Clear History Only</span>
            </Button>
          </div>

          {/* Card 2: Full Factory Reset */}
          <div className="p-4 rounded-2xl bg-md-error/5 border border-md-error/25 flex flex-col justify-between gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-md-error" />
                <span className="text-sm font-bold text-md-error">Factory Reset Everything</span>
              </div>
              <p className="text-xs text-md-on-surface-variant leading-relaxed">
                Completely erases all sessions, coffee cups, custom tags, and resets all configurations and profile data to default. Clears cloud records if signed in.
              </p>
            </div>
            <Button
              variant="filled"
              size="sm"
              className="bg-md-error hover:bg-red-700 text-white justify-center w-full mt-2 font-semibold"
              onClick={() => setResetModalScope('factory-reset')}
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              <span>Erase All Data</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* Danger Zone Confirmation Modal */}
      <Modal
        isOpen={!!resetModalScope}
        onClose={() => setResetModalScope(null)}
        title={resetModalScope === 'sessions-only' ? 'Clear Focus & Coffee History' : 'Reset All Data'}
      >
        {resetModalScope && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-md-error/10 text-md-error flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-md-error font-medium">This action cannot be undone.</p>
              </div>
            </div>

            {resetModalScope === 'sessions-only' ? (
              <div className="flex flex-col gap-2.5 text-xs">
                <div className="p-3 rounded-2xl bg-md-error/10 border border-md-error/20 flex flex-col gap-1 text-md-error">
                  <span className="font-bold">Items that will be deleted:</span>
                  <span>• {sessions.length} completed focus & break sessions</span>
                  <span>• {coffeeCups.length} logged coffee cups</span>
                </div>
                <div className="p-3 rounded-2xl bg-md-surface-container border border-md-outline-variant/15 flex flex-col gap-1 text-md-on-surface-variant">
                  <span className="font-bold text-md-on-surface">Items that are preserved:</span>
                  <span>• All {tags.length} custom tags & colors</span>
                  <span>• Daily focus goal ({profile.dailyGoalMinutes} min)</span>
                  <span>• Timer intervals & sound settings</span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 text-xs">
                <div className="p-3 rounded-2xl bg-md-error/10 border border-md-error/20 flex flex-col gap-1 text-md-error">
                  <span className="font-bold">Everything below will be permanently wiped:</span>
                  <span>• All {sessions.length} completed sessions</span>
                  <span>• All {coffeeCups.length} coffee cups</span>
                  <span>• All {tags.length} custom tags</span>
                  <span>• All timer preferences (reset to defaults)</span>
                  <span>• Profile target and display settings</span>
                  {isAuthenticated && <span>• All remote cloud records for your account</span>}
                </div>
                <p className="text-[11px] text-md-on-surface-variant italic">
                  Tip: Use the "Export JSON Backup" button first if you may want to restore your data later.
                </p>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-md-outline-variant/20">
              <Button variant="text" size="sm" onClick={() => setResetModalScope(null)}>
                Cancel
              </Button>
              <Button
                variant="filled"
                size="sm"
                disabled={isResetting}
                className="bg-md-error text-white hover:bg-red-700 font-semibold disabled:opacity-50"
                onClick={handleConfirmReset}
              >
                {isResetting
                  ? 'Wiping...'
                  : resetModalScope === 'sessions-only'
                  ? 'Yes, Delete History'
                  : 'Yes, Wipe Everything'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};
