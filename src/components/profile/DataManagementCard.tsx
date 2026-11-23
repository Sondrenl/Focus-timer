import React, { useState, useRef, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Download, Check, AlertTriangle } from 'lucide-react';
import { BackupData } from '../../types/user';
import { toDateKey } from '../../utils/dates';

interface DataManagementCardProps {
  exportBackup: () => BackupData;
  statusMessage: string | null;
  errorMessage: string | null;
}

export const DataManagementCard: React.FC<DataManagementCardProps> = ({
  exportBackup,
  statusMessage,
  errorMessage,
}) => {
  const [exportedSuccess, setExportedSuccess] = useState(false);
  const exportTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (exportTimeoutRef.current !== null) {
        clearTimeout(exportTimeoutRef.current);
      }
    };
  }, []);

  const handleExportData = () => {
    const backup = exportBackup();
    const jsonStr = JSON.stringify(backup, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const dateStr = toDateKey(new Date());

    const a = document.createElement('a');
    a.href = url;
    a.download = `focus-timer-backup-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setExportedSuccess(true);
    if (exportTimeoutRef.current !== null) {
      clearTimeout(exportTimeoutRef.current);
    }
    exportTimeoutRef.current = setTimeout(() => {
      exportTimeoutRef.current = null;
      setExportedSuccess(false);
    }, 2500);
  };

  return (
    <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20 flex flex-col gap-4">
      <div>
        <h3 className="text-base font-bold text-md-on-surface">Data Management</h3>
        <p className="text-xs text-md-on-surface-variant mt-1">
          Export your full history, tags, coffee counts, and preferences as JSON.
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
  );
};
