import React, { useState } from 'react';
import { User, Cloud, ShieldCheck, Download, Check, Sparkles } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

export const ProfileView: React.FC = () => {
  const { sessions, tags, settings } = useApp();
  const [copied, setCopied] = useState(false);

  const handleExportData = () => {
    const backup = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      tags,
      sessions,
      settings,
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pomodor-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full max-w-3xl mx-auto py-6 px-4 flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-md-on-surface">User Profile & Sync</h2>
        <p className="text-xs text-md-on-surface-variant mt-0.5">
          Local client account, data sovereignty, and upcoming synchronization features.
        </p>
      </div>

      {/* Profile Header Card */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20 flex flex-col sm:flex-row items-center gap-5 text-center sm:text-left">
        <div className="w-20 h-20 rounded-full bg-md-primary/10 border-2 border-md-primary/30 flex items-center justify-center text-md-primary shadow-xs">
          <User className="w-10 h-10" />
        </div>
        <div className="flex-1">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <h3 className="text-xl font-bold text-md-on-surface">Focus Practitioner</h3>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-md-primary-container text-md-on-primary-container mx-auto sm:mx-0">
              <Sparkles className="w-3 h-3" /> MVP Local Edition
            </span>
          </div>
          <p className="text-xs text-md-on-surface-variant mt-1">
            Data is currently persisted in your browser's local sandbox repository via the Repository/Service layer.
          </p>
          <div className="flex items-center justify-center sm:justify-start gap-4 text-xs font-medium text-md-on-surface-variant mt-3">
            <span><strong>{sessions.length}</strong> total sessions</span>
            <span>•</span>
            <span><strong>{tags.length}</strong> tags</span>
          </div>
        </div>
      </Card>

      {/* Cloud Sync Placeholder Stub */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-md-secondary-container flex items-center justify-center text-md-on-secondary-container">
            <Cloud className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-base font-bold text-md-on-surface">
              Cloud Synchronization (Coming Soon in v2.0)
            </h4>
            <p className="text-xs text-md-on-surface-variant">
              Seamlessly sync your focus sessions, custom tags, and stats across macOS, Windows, iOS, and Android.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <div className="p-3 rounded-2xl bg-md-surface-container text-xs">
            <span className="font-bold text-md-on-surface block mb-1">Multi-device Continuity</span>
            Resume your active pomodoro timers across tablets, laptops, and phones seamlessly.
          </div>
          <div className="p-3 rounded-2xl bg-md-surface-container text-xs">
            <span className="font-bold text-md-on-surface block mb-1">End-to-End Encryption</span>
            Zero-knowledge encryption protects your tag labels and daily task titles.
          </div>
          <div className="p-3 rounded-2xl bg-md-surface-container text-xs">
            <span className="font-bold text-md-on-surface block mb-1">Calendar & Webhooks</span>
            Automate status updates in Slack, Microsoft Teams, and Google Calendar.
          </div>
        </div>
      </Card>

      {/* Data Sovereignty & Portability */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-600" />
          <h4 className="text-base font-bold text-md-on-surface">Data Sovereignty & Portability</h4>
        </div>
        <p className="text-xs text-md-on-surface-variant">
          You own 100% of your telemetry and session data. Download a complete JSON snapshot anytime or prepare for upcoming remote server sync.
        </p>

        <div className="flex items-center gap-3 pt-1">
          <Button variant="tonal" size="sm" onClick={handleExportData}>
            {copied ? <Check className="w-4 h-4 mr-1.5" /> : <Download className="w-4 h-4 mr-1.5" />}
            <span>{copied ? 'Exported Backup!' : 'Export JSON Backup'}</span>
          </Button>
        </div>
      </Card>
    </div>
  );
};
