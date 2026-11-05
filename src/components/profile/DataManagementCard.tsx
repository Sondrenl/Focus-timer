import React, { useState, useRef } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Download, Upload, Check, AlertTriangle, Sparkles } from 'lucide-react';
import { BackupData } from '../../types/user';

interface DataManagementCardProps {
  exportBackup: () => BackupData;
  importBackup: (
    data: BackupData,
    mode: 'merge' | 'replace'
  ) => Promise<{ sessionsAdded: number; tagsAdded: number; coffeeAdded?: number }>;
  reloadSampleData: () => Promise<void>;
  isDemoEnvironment: boolean;
  isAuthenticated: boolean;
  statusMessage: string | null;
  errorMessage: string | null;
  onStatusMessage: (msg: string | null) => void;
  onErrorMessage: (msg: string | null) => void;
}

export const DataManagementCard: React.FC<DataManagementCardProps> = ({
  exportBackup,
  importBackup,
  reloadSampleData,
  isDemoEnvironment,
  isAuthenticated,
  statusMessage,
  errorMessage,
  onStatusMessage,
  onErrorMessage,
}) => {
  const [exportedSuccess, setExportedSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingBackup, setPendingBackup] = useState<BackupData | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');

  const handleExportData = () => {
    const backup = exportBackup();
    const jsonStr = JSON.stringify(backup, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().slice(0, 10);

    const a = document.createElement('a');
    a.href = url;
    a.download = `focus-timer-backup-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setExportedSuccess(true);
    setTimeout(() => setExportedSuccess(false), 2500);
  };

  const handleSelectImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    onErrorMessage(null);
    onStatusMessage(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('Invalid JSON format');
        }

        const rawTags = Array.isArray(parsed.tags) ? parsed.tags : [];
        const rawSessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
        const rawCoffee = Array.isArray(parsed.coffeeCups)
          ? parsed.coffeeCups
          : Array.isArray(parsed.coffee_cups)
          ? parsed.coffee_cups
          : [];

        if (rawTags.length === 0 && rawSessions.length === 0 && rawCoffee.length === 0) {
          throw new Error('File does not appear to be a valid Focus Timer backup.');
        }

        setPendingBackup({
          version: parsed.version || '3.0.1',
          exportedAt: parsed.exportedAt || new Date().toISOString(),
          profile: parsed.profile,
          settings: parsed.settings,
          tags: rawTags,
          sessions: rawSessions,
          coffeeCups: rawCoffee,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to parse JSON backup file';
        onErrorMessage(msg);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleConfirmImport = async () => {
    if (!pendingBackup) return;

    try {
      const result = await importBackup(pendingBackup, importMode);
      setPendingBackup(null);
      const parts = [
        `${result.sessionsAdded} sessions`,
        `${result.tagsAdded} tags`,
      ];
      if (typeof result.coffeeAdded === 'number') {
        parts.push(`${result.coffeeAdded} coffee cups`);
      }
      onStatusMessage(`Import complete! Restored ${parts.join(', ')}.`);
      setTimeout(() => onStatusMessage(null), 4000);
    } catch {
      onErrorMessage('An error occurred during import.');
    }
  };

  return (
    <>
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20 flex flex-col gap-4">
        <div>
          <h3 className="text-base font-bold text-md-on-surface">Data Management</h3>
          <p className="text-xs text-md-on-surface-variant mt-1">
            Export or restore your full history, tags, coffee counts, and preferences as JSON.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t border-md-outline-variant/15">
          <Button
            variant="tonal"
            className="flex-1 justify-center"
            onClick={handleExportData}
          >
            {exportedSuccess ? (
              <>
                <Check className="w-4 h-4 mr-2 text-emerald-600" />
                <span>Backup Downloaded!</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                <span>Export JSON Backup</span>
              </>
            )}
          </Button>

          <Button
            variant="outlined"
            className="flex-1 justify-center"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-4 h-4 mr-2" />
            <span>Restore from Backup</span>
          </Button>
          {isDemoEnvironment && !isAuthenticated && (
            <Button
              variant="outlined"
              className="flex-1 justify-center"
              onClick={async () => {
                await reloadSampleData();
                onStatusMessage('Sample data loaded for dev/preview mode.');
                setTimeout(() => onStatusMessage(null), 4000);
              }}
            >
              <Sparkles className="w-4 h-4 mr-2" />
              <span>Load Sample Data (Dev)</span>
            </Button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleSelectImportFile}
            className="hidden"
          />
        </div>

        {statusMessage && (
          <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 text-xs font-semibold flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="p-3 rounded-2xl bg-md-error/10 border border-md-error/20 text-md-error text-xs font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
      </Card>

      {/* Import Confirmation Modal */}
      {pendingBackup && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-md-surface-container-lowest p-6 rounded-3xl max-w-md w-full border border-md-outline-variant/30 shadow-elevation-3 flex flex-col gap-4">
            <h3 className="text-base font-bold text-md-on-surface">Import Backup Data</h3>
            <div className="p-3 rounded-2xl bg-md-surface-container text-xs text-md-on-surface-variant flex flex-col gap-1">
              <span>• Sessions to import: {pendingBackup.sessions.length}</span>
              <span>• Tags to import: {pendingBackup.tags.length}</span>
              <span>• Coffee cups to import: {pendingBackup.coffeeCups?.length || 0}</span>
              <span>• Exported on: {new Date(pendingBackup.exportedAt).toLocaleDateString()}</span>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-md-on-surface">
                Choose Import Mode:
              </label>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 p-2.5 rounded-xl border border-md-outline-variant/30 hover:bg-md-surface-container cursor-pointer text-xs">
                  <input
                    type="radio"
                    name="importMode"
                    value="merge"
                    checked={importMode === 'merge'}
                    onChange={() => setImportMode('merge')}
                    className="accent-md-primary"
                  />
                  <div>
                    <span className="font-bold block text-md-on-surface">Merge with Existing</span>
                    <span className="text-md-on-surface-variant text-[11px]">
                      Preserves your current sessions, tags and coffee, adding missing ones.
                    </span>
                  </div>
                </label>

                <label className="flex items-center gap-2 p-2.5 rounded-xl border border-md-outline-variant/30 hover:bg-md-surface-container cursor-pointer text-xs">
                  <input
                    type="radio"
                    name="importMode"
                    value="replace"
                    checked={importMode === 'replace'}
                    onChange={() => setImportMode('replace')}
                    className="accent-md-primary"
                  />
                  <div>
                    <span className="font-bold block text-md-error">Replace (Override)</span>
                    <span className="text-md-on-surface-variant text-[11px]">
                      Replaces all existing sessions, tags and coffee logs with the backup contents.
                    </span>
                  </div>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-md-outline-variant/20">
              <Button variant="text" size="sm" onClick={() => setPendingBackup(null)}>
                Cancel
              </Button>
              <Button variant="filled" size="sm" onClick={handleConfirmImport}>
                Confirm Import
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
