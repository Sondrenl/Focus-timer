import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Download,
  Upload,
  Check,
  Sparkles,
  Target,
  AlertTriangle,
  RotateCcw,
  Trash2,
  Edit2,
  User,
  Cloud,
  RefreshCw,
  LogOut,
  CheckCircle2,
  ShieldCheck,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { AVATAR_EMOJI_OPTIONS, BackupData } from '../../types/user';
import { toDateKey } from '../../utils/dates';
import { formatDurationHoursMins } from '../../utils/formatters';

const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  '229654613287-8utvd3fhrcsalh1ol02ev2mlg140kbai.apps.googleusercontent.com';

export const ProfileView: React.FC = () => {
  const {
    auth,
    loginWithGoogle,
    logout,
    syncWithCloud,
    profile,
    updateProfile,
    sessions,
    tags,
    exportBackup,
    importBackup,
    resetAllData,
  } = useApp();

  // Export state
  const [exportedSuccess, setExportedSuccess] = useState(false);

  // Edit Profile modal state
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState(profile.displayName);
  const [editEmoji, setEditEmoji] = useState(profile.avatarEmoji);
  const [editGoalMinutes, setEditGoalMinutes] = useState(profile.dailyGoalMinutes);

  // Import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingBackup, setPendingBackup] = useState<BackupData | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccessMessage, setImportSuccessMessage] = useState<string | null>(null);

  // Danger Zone confirmation modal state
  const [resetModalScope, setResetModalScope] = useState<'sessions-only' | 'factory-reset' | null>(null);

  // Google Sign-In button container ref
  const googleButtonContainerRef = useRef<HTMLDivElement>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Render Google Identity Services button
  useEffect(() => {
    if (auth.isAuthenticated) return;

    const renderGoogleBtn = () => {
      if (window.google?.accounts?.id && googleButtonContainerRef.current) {
        try {
          window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: async (response) => {
              if (response.credential) {
                try {
                  setAuthError(null);
                  await loginWithGoogle(response.credential);
                } catch (err) {
                  setAuthError((err as Error).message || 'Google authentication failed');
                }
              }
            },
          });

          window.google.accounts.id.renderButton(googleButtonContainerRef.current, {
            theme: 'outline',
            size: 'large',
            text: 'continue_with',
            shape: 'pill',
            width: 260,
          });
        } catch (e) {
          console.warn('Google Identity initialization error', e);
        }
      }
    };

    renderGoogleBtn();
    const timer = setTimeout(renderGoogleBtn, 800);
    return () => clearTimeout(timer);
  }, [auth.isAuthenticated, loginWithGoogle]);

  // Calculate today's focus minutes
  const todayKey = toDateKey(new Date());
  const todayFocusSeconds = useMemo(() => {
    return sessions
      .filter((s) => s.sessionType === 'WORK' && toDateKey(s.completedAt) === todayKey)
      .reduce((acc, s) => acc + s.durationSeconds, 0);
  }, [sessions, todayKey]);

  const todayFocusMinutes = Math.round(todayFocusSeconds / 60);
  const goalMinutes = Math.max(1, profile.dailyGoalMinutes || 120);
  const goalProgressPercent = Math.min(100, Math.round((todayFocusMinutes / goalMinutes) * 100));

  // Lifetime focus stats
  const totalFocusSeconds = useMemo(() => {
    return sessions
      .filter((s) => s.sessionType === 'WORK')
      .reduce((acc, s) => acc + s.durationSeconds, 0);
  }, [sessions]);

  // Handle Export
  const handleExport = () => {
    const backup = exportBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pomodor-backup-${toDateKey(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setExportedSuccess(true);
    setTimeout(() => setExportedSuccess(false), 2500);
  };

  // Open File Browser for Import
  const handleSelectImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportError(null);
    setImportSuccessMessage(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('Invalid JSON format');
        }

        const hasTags = Array.isArray(parsed.tags);
        const hasSessions = Array.isArray(parsed.sessions);

        if (!hasTags && !hasSessions) {
          throw new Error('File does not appear to be a valid Pomodor backup.');
        }

        setPendingBackup({
          version: parsed.version || '2.0.1',
          exportedAt: parsed.exportedAt || new Date().toISOString(),
          profile: parsed.profile,
          settings: parsed.settings,
          tags: parsed.tags || [],
          sessions: parsed.sessions || [],
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to parse JSON backup file';
        setImportError(msg);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  // Confirm Import
  const handleConfirmImport = async () => {
    if (!pendingBackup) return;

    try {
      const result = await importBackup(pendingBackup, importMode);
      setPendingBackup(null);
      setImportSuccessMessage(
        `Import complete! Restored ${result.sessionsAdded} sessions and ${result.tagsAdded} tags.`
      );
      setTimeout(() => setImportSuccessMessage(null), 4000);
    } catch {
      setImportError('An error occurred during import.');
    }
  };

  // Save Profile Changes
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateProfile({
      displayName: editName.trim() || 'Focus Practitioner',
      avatarEmoji: editEmoji,
      dailyGoalMinutes: Number(editGoalMinutes) || 120,
    });
    setIsEditingProfile(false);
  };

  // Handle Reset Execution
  const handleConfirmReset = async () => {
    if (!resetModalScope) return;
    await resetAllData(resetModalScope);
    setResetModalScope(null);
  };

  return (
    <div className="w-full max-w-3xl mx-auto py-6 px-4 flex flex-col gap-6">
      {/* Title */}
      <div>
        <h2 className="text-2xl font-bold text-md-on-surface">User Profile & Data</h2>
      </div>

      {/* Profile Header Card */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20 flex flex-col gap-5">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 text-center sm:text-left">
          {/* Avatar Icon */}
          <div className="relative group">
            <div className="w-20 h-20 rounded-3xl bg-md-primary/10 border-2 border-md-primary/30 flex items-center justify-center text-3xl shadow-xs select-none overflow-hidden">
              {profile.avatarEmoji ? (
                profile.avatarEmoji
              ) : profile.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt={profile.displayName}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <User className="w-10 h-10 text-md-primary" />
              )}
            </div>
            <button
              onClick={() => {
                setEditName(profile.displayName);
                setEditEmoji(profile.avatarEmoji);
                setEditGoalMinutes(profile.dailyGoalMinutes);
                setIsEditingProfile(true);
              }}
              className="absolute -bottom-1 -right-1 p-1.5 rounded-full bg-md-primary text-md-on-primary hover:bg-[#584192] transition-colors shadow-sm"
              title="Change Avatar & Profile"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-xl font-bold text-md-on-surface">{profile.displayName}</h3>
                {auth.isAuthenticated && auth.user?.email ? (
                  <span className="inline-flex items-center gap-1 text-xs text-md-on-surface-variant font-mono mt-0.5">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" /> {auth.user.email}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-md-primary mt-0.5">
                    <Sparkles className="w-3 h-3" /> Focus Account
                  </span>
                )}
              </div>

              <Button
                variant="outlined"
                size="sm"
                onClick={() => {
                  setEditName(profile.displayName);
                  setEditEmoji(profile.avatarEmoji);
                  setEditGoalMinutes(profile.dailyGoalMinutes);
                  setIsEditingProfile(true);
                }}
              >
                <Edit2 className="w-3.5 h-3.5 mr-1" />
                Edit Profile
              </Button>
            </div>

            {/* Daily Goal Progress Bar with clear Edit Target button */}
            <div className="mt-4 p-3.5 rounded-2xl bg-md-surface-container/70 border border-md-outline-variant/15">
              <div className="flex items-center justify-between text-xs font-semibold mb-1.5">
                <span className="flex items-center gap-1.5 text-md-on-surface">
                  <Target className="w-4 h-4 text-md-primary" />
                  Today's Focus Target
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-md-on-surface-variant font-mono">
                    {todayFocusMinutes}m / {profile.dailyGoalMinutes}m ({goalProgressPercent}%)
                  </span>
                  <button
                    onClick={() => {
                      setEditName(profile.displayName);
                      setEditEmoji(profile.avatarEmoji);
                      setEditGoalMinutes(profile.dailyGoalMinutes);
                      setIsEditingProfile(true);
                    }}
                    className="text-xs font-bold text-md-primary hover:underline ml-1 px-1.5 py-0.5 rounded-lg bg-md-primary/10"
                  >
                    Edit Goal
                  </button>
                </div>
              </div>

              <div className="w-full h-2.5 rounded-full bg-md-surface-variant overflow-hidden">
                <div
                  className="h-full rounded-full bg-md-primary transition-all duration-500 ease-out"
                  style={{ width: `${goalProgressPercent}%` }}
                />
              </div>

              {goalProgressPercent >= 100 && (
                <div className="mt-2 text-xs font-bold text-emerald-600 flex items-center gap-1">
                  🎉 Daily target completed! Great work today.
                </div>
              )}
            </div>

            {/* Lifetime Summary */}
            <div className="grid grid-cols-3 gap-2 text-center mt-3 pt-2 border-t border-md-outline-variant/15 text-xs text-md-on-surface-variant">
              <div>
                <span className="block font-bold text-sm text-md-on-surface">
                  {formatDurationHoursMins(totalFocusSeconds)}
                </span>
                Total Focus Time
              </div>
              <div>
                <span className="block font-bold text-sm text-md-on-surface">
                  {sessions.filter((s) => s.sessionType === 'WORK').length}
                </span>
                Pomodoros Completed
              </div>
              <div>
                <span className="block font-bold text-sm text-md-on-surface">
                  {tags.length}
                </span>
                Tags Created
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Cloud Account Sync Card */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-md-primary/10 text-md-primary flex items-center justify-center">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-md-on-surface">Cloud Account & Sync</h3>
            </div>
          </div>

          {auth.isAuthenticated && (
            <Button
              variant="tonal"
              size="sm"
              onClick={syncWithCloud}
              disabled={auth.isSyncing}
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${auth.isSyncing ? 'animate-spin' : ''}`} />
              <span>{auth.isSyncing ? 'Syncing...' : 'Sync Now'}</span>
            </Button>
          )}
        </div>

        {auth.isAuthenticated ? (
          <div className="flex flex-col gap-3 pt-2 border-t border-md-outline-variant/15">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-semibold text-md-on-surface">Sync Active</span>
              </div>
              <Button
                variant="text"
                size="sm"
                onClick={logout}
                className="text-md-error hover:bg-md-error/10"
              >
                <LogOut className="w-3.5 h-3.5 mr-1.5" />
                <span>Sign Out</span>
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 border-t border-md-outline-variant/15">
            <div className="text-xs text-md-on-surface-variant">
              Sign in with your Google account to automatically synchronize sessions and tags across all devices.
            </div>
            <div ref={googleButtonContainerRef} className="shrink-0 min-h-[40px]" />
          </div>
        )}

        {authError && (
          <div className="text-xs text-md-error bg-md-error/10 p-2.5 rounded-xl border border-md-error/20">
            {authError}
          </div>
        )}
      </Card>

      {/* Data Backup & Portability */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-md-secondary/10 text-md-secondary flex items-center justify-center">
            <Download className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-md-on-surface">Data Backup & Portability</h3>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-md-outline-variant/15">
          <Button
            variant="tonal"
            className="w-full justify-center"
            onClick={handleExport}
          >
            {exportedSuccess ? (
              <>
                <Check className="w-4 h-4 mr-2 text-emerald-600" />
                <span>Downloaded Backup!</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                <span>Export Backup (JSON)</span>
              </>
            )}
          </Button>

          <Button
            variant="outlined"
            className="w-full justify-center"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-4 h-4 mr-2" />
            <span>Import Backup...</span>
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleSelectImportFile}
            className="hidden"
          />
        </div>

        {importSuccessMessage && (
          <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 text-xs font-semibold flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{importSuccessMessage}</span>
          </div>
        )}

        {importError && (
          <div className="p-3 rounded-2xl bg-md-error/10 border border-md-error/20 text-md-error text-xs font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{importError}</span>
          </div>
        )}
      </Card>

      {/* Danger Zone */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-error/20 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-md-error/10 text-md-error flex items-center justify-center">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-md-error">Danger Zone</h3>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t border-md-outline-variant/15">
          <Button
            variant="text"
            className="text-md-error hover:bg-md-error/10 justify-center flex-1"
            onClick={() => setResetModalScope('sessions-only')}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            <span>Clear History Only</span>
          </Button>

          <Button
            variant="filled"
            className="bg-md-error hover:bg-red-700 text-white justify-center flex-1"
            onClick={() => setResetModalScope('factory-reset')}
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            <span>Full Reset (Erase All)</span>
          </Button>
        </div>
      </Card>

      {/* Edit Profile Modal */}
      <Modal
        isOpen={isEditingProfile}
        onClose={() => setIsEditingProfile(false)}
        title="Edit Profile & Goals"
      >
        <form onSubmit={handleSaveProfile} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-md-on-surface-variant">
              Display Name
            </label>
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Your name or handle"
              maxLength={30}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-md-on-surface-variant">
              Avatar Icon
            </label>
            <div className="grid grid-cols-6 gap-2">
              <button
                type="button"
                onClick={() => setEditEmoji('')}
                className={`p-2.5 rounded-2xl text-xs font-bold border transition-all text-center ${
                  editEmoji === ''
                    ? 'border-md-primary bg-md-primary/10 text-md-primary shadow-xs'
                    : 'border-md-outline-variant/30 hover:bg-md-surface-container'
                }`}
              >
                {profile.avatarUrl ? 'Photo' : 'Default'}
              </button>
              {AVATAR_EMOJI_OPTIONS.map((emoji) => (
                <button
                  type="button"
                  key={emoji}
                  onClick={() => setEditEmoji(emoji)}
                  className={`p-2.5 rounded-2xl text-xl border transition-all text-center ${
                    editEmoji === emoji
                      ? 'border-md-primary bg-md-primary/10 shadow-xs scale-105'
                      : 'border-md-outline-variant/30 hover:bg-md-surface-container'
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-md-on-surface-variant">
              Daily Focus Target (Minutes)
            </label>
            <Input
              type="number"
              min={15}
              max={1440}
              step={15}
              value={editGoalMinutes}
              onChange={(e) => setEditGoalMinutes(parseInt(e.target.value) || 120)}
            />
            <span className="text-[11px] text-md-outline">
              Goal: {(editGoalMinutes / 60).toFixed(1)} hours per day
            </span>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-md-outline-variant/20">
            <Button type="button" variant="text" size="sm" onClick={() => setIsEditingProfile(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="filled" size="sm">
              Save Profile
            </Button>
          </div>
        </form>
      </Modal>

      {/* Import Confirmation Modal */}
      {pendingBackup && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-md-surface-container-lowest p-6 rounded-3xl max-w-md w-full border border-md-outline-variant/30 shadow-elevation-3 flex flex-col gap-4">
            <h3 className="text-base font-bold text-md-on-surface">Import Backup Data</h3>
            <div className="p-3 rounded-2xl bg-md-surface-container text-xs text-md-on-surface-variant flex flex-col gap-1">
              <span>• Sessions to import: {pendingBackup.sessions.length}</span>
              <span>• Tags to import: {pendingBackup.tags.length}</span>
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
                      Preserves your current sessions and tags, adding missing ones.
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
                      Replaces all existing sessions and tags with the backup contents.
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

      {/* Reset Confirmation Modal */}
      {resetModalScope && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-md-surface-container-lowest p-6 rounded-3xl max-w-sm w-full border border-md-outline-variant/30 shadow-elevation-3 flex flex-col gap-4">
            <div className="w-12 h-12 rounded-2xl bg-md-error/10 text-md-error flex items-center justify-center">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-md-on-surface">
                {resetModalScope === 'sessions-only' ? 'Clear Focus History?' : 'Reset Everything?'}
              </h3>
              <p className="text-xs text-md-on-surface-variant mt-1 leading-relaxed">
                {resetModalScope === 'sessions-only'
                  ? 'This will delete all completed focus sessions. Your custom tags and preferences will remain intact.'
                  : 'This will erase all sessions, custom tags, and reset all settings back to default.'}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="text" size="sm" onClick={() => setResetModalScope(null)}>
                Cancel
              </Button>
              <Button
                variant="filled"
                size="sm"
                className="bg-md-error text-white hover:bg-red-700"
                onClick={handleConfirmReset}
              >
                Confirm Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
