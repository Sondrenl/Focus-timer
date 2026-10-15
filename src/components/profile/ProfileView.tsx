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
    isDemoEnvironment,
    reloadSampleData,
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
          version: parsed.version || '1.0.0',
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
        <p className="text-xs text-md-on-surface-variant mt-0.5">
          Personal identity, daily focus goals, and cross-device cloud synchronization.
        </p>
      </div>

      {/* Preview Environment Banner */}
      {isDemoEnvironment && (
        <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
            <Sparkles className="w-4 h-4 shrink-0 text-amber-600" />
            <span>
              <strong>Preview Mode Active</strong>: Sample focus sessions are loaded so you can test stats and goals. Production stays 100% clean.
            </span>
          </div>
          <Button
            variant="tonal"
            size="sm"
            className="text-xs shrink-0 self-end sm:self-auto bg-amber-500/15 text-amber-900 dark:text-amber-100 hover:bg-amber-500/25"
            onClick={async () => {
              await reloadSampleData();
              setImportSuccessMessage('Sample focus data reloaded successfully!');
              setTimeout(() => setImportSuccessMessage(null), 3000);
            }}
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1" />
            Reload Demo Data
          </Button>
        </div>
      )}

      {/* Profile Header Card */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20 flex flex-col gap-5">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 text-center sm:text-left">
          {/* Avatar Icon */}
          <div className="relative group">
            <div className="w-20 h-20 rounded-3xl bg-md-primary/10 border-2 border-md-primary/30 flex items-center justify-center text-3xl shadow-xs select-none overflow-hidden">
              {profile.avatarEmoji ? (
                profile.avatarEmoji
              ) : profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt="User Avatar" className="w-full h-full object-cover" />
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
                ) : isDemoEnvironment ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-500/15 px-2 py-0.5 rounded-full mt-0.5">
                    <Sparkles className="w-3 h-3" /> Preview Test Account
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-md-primary mt-0.5">
                    <Sparkles className="w-3 h-3" /> Local Focus Account
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

            {/* Daily Goal Progress Bar */}
            <div className="mt-4 p-3.5 rounded-2xl bg-md-surface-container/70 border border-md-outline-variant/15">
              <div className="flex items-center justify-between text-xs font-semibold mb-1.5">
                <span className="flex items-center gap-1.5 text-md-on-surface">
                  <Target className="w-4 h-4 text-md-primary" />
                  Today's Focus Target
                </span>
                <span className="text-md-on-surface-variant font-mono">
                  {todayFocusMinutes}m / {profile.dailyGoalMinutes}m ({goalProgressPercent}%)
                </span>
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
                <span className="text-[11px]">Total Focus</span>
              </div>
              <div>
                <span className="block font-bold text-sm text-md-on-surface">
                  {sessions.filter((s) => s.sessionType === 'WORK').length}
                </span>
                <span className="text-[11px]">Sessions</span>
              </div>
              <div>
                <span className="block font-bold text-sm text-md-on-surface">
                  {tags.filter((t) => !t.isArchived).length}
                </span>
                <span className="text-[11px]">Active Tags</span>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Cloud Sync & Google Authentication Card */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20 flex flex-col gap-4">
        {auth.isAuthenticated && auth.user ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-600 shrink-0">
                  <Cloud className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-base font-bold text-md-on-surface">Cloud Account Connected</h4>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Active Sync
                    </span>
                  </div>
                  <p className="text-xs text-md-on-surface-variant">
                    Logged in as <strong>{auth.user.email}</strong>. Data is synchronized across your devices.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-auto">
                <Button
                  variant="outlined"
                  size="sm"
                  onClick={() => syncWithCloud()}
                  disabled={auth.isSyncing}
                >
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${auth.isSyncing ? 'animate-spin' : ''}`} />
                  {auth.isSyncing ? 'Syncing...' : 'Sync Now'}
                </Button>

                <Button
                  variant="text"
                  size="sm"
                  className="text-md-on-surface-variant hover:text-md-error"
                  onClick={logout}
                  title="Disconnect account"
                >
                  <LogOut className="w-3.5 h-3.5 mr-1.5" />
                  Sign Out
                </Button>
              </div>
            </div>

            {/* Sync Status Banner */}
            <div className="p-3 rounded-2xl bg-md-surface-container/60 border border-md-outline-variant/15 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-md-on-surface-variant">
                <ShieldCheck className="w-4 h-4 text-md-primary" />
                <span>
                  {auth.lastSyncedAt
                    ? `Last synchronized: ${new Date(auth.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                    : 'Synced with Cloudflare D1'}
                </span>
              </div>
              <span className="text-[11px] text-md-on-surface-variant/80">
                Offline-capable: Changes save locally and sync when connected.
              </span>
            </div>

            {auth.syncError && (
              <div className="p-3 rounded-2xl bg-md-error-container/20 border border-md-error/30 text-xs font-semibold text-md-error flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Sync note: {auth.syncError}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-md-primary/10 border border-md-primary/20 flex items-center justify-center text-md-primary shrink-0 mt-0.5 sm:mt-0">
                <Cloud className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-base font-bold text-md-on-surface">Cloud Backup & Cross-Device Sync</h4>
                <p className="text-xs text-md-on-surface-variant max-w-md mt-0.5">
                  Sign in with Google to automatically sync your focus sessions, custom tags, and settings across your laptop, phone, and tablet.
                </p>
              </div>
            </div>

            <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
              <div ref={googleButtonContainerRef} className="min-h-[40px] flex items-center" />
              {authError && (
                <span className="text-[11px] font-semibold text-md-error">
                  {authError}
                </span>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Data Backup & Restore */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20 flex flex-col gap-4">
        <div>
          <h4 className="text-base font-bold text-md-on-surface">Data Backup & Restore</h4>
          <p className="text-xs text-md-on-surface-variant mt-0.5">
            Export a full JSON backup of your tags, sessions, and settings to move data between devices, or restore an existing backup.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {/* Export Button */}
          <Button variant="tonal" size="sm" onClick={handleExport}>
            {exportedSuccess ? <Check className="w-4 h-4 mr-1.5" /> : <Download className="w-4 h-4 mr-1.5" />}
            <span>{exportedSuccess ? 'Backup Downloaded!' : 'Export JSON Backup'}</span>
          </Button>

          {/* Import Button */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleSelectImportFile}
            accept=".json,application/json"
            className="hidden"
          />
          <Button
            variant="outlined"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-4 h-4 mr-1.5" />
            <span>Restore from File</span>
          </Button>
        </div>

        {/* Feedback Messages */}
        {importSuccessMessage && (
          <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-xs font-semibold text-emerald-700 flex items-center gap-2 animate-in fade-in">
            <Check className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{importSuccessMessage}</span>
          </div>
        )}

        {importError && (
          <div className="p-3 rounded-2xl bg-md-error-container/20 border border-md-error/30 text-xs font-semibold text-md-error flex items-center gap-2 animate-in fade-in">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{importError}</span>
          </div>
        )}
      </Card>

      {/* Danger Zone */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-error/20 flex flex-col gap-4">
        <div>
          <h4 className="text-base font-bold text-md-error flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Reset Data
          </h4>
          <p className="text-xs text-md-on-surface-variant mt-0.5">
            Clear your recorded sessions or restore the entire application to its factory defaults.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button
            variant="outlined"
            size="sm"
            className="border-md-outline-variant text-md-on-surface hover:bg-md-error/5 hover:text-md-error hover:border-md-error/50"
            onClick={() => setResetModalScope('sessions-only')}
          >
            <RotateCcw className="w-4 h-4 mr-1.5" />
            Clear Sessions Only
          </Button>

          <Button
            variant="outlined"
            size="sm"
            className="border-md-error/40 text-md-error hover:bg-md-error/10"
            onClick={() => setResetModalScope('factory-reset')}
          >
            <Trash2 className="w-4 h-4 mr-1.5" />
            Factory Reset
          </Button>
        </div>
      </Card>

      {/* --- MODALS --- */}

      {/* Edit Profile Modal */}
      <Modal
        isOpen={isEditingProfile}
        onClose={() => setIsEditingProfile(false)}
        title="Edit Profile & Goals"
      >
        <form onSubmit={handleSaveProfile} className="flex flex-col gap-4 pt-1">
          {/* Avatar Emoji Selector */}
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <label className="text-xs font-semibold text-md-on-surface-variant block">
                Choose Avatar
              </label>
              {editEmoji && (
                <button
                  type="button"
                  onClick={() => setEditEmoji('')}
                  className="text-xs text-md-primary hover:underline font-medium"
                >
                  Reset to default icon
                </button>
              )}
            </div>
            <div className="grid grid-cols-7 gap-2">
              <button
                type="button"
                onClick={() => setEditEmoji('')}
                title="Default Icon"
                className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all ${
                  !editEmoji
                    ? 'bg-md-primary/15 border-2 border-md-primary text-md-primary scale-105'
                    : 'bg-md-surface-container-highest hover:bg-md-surface-variant text-md-outline'
                }`}
              >
                <User className="w-5 h-5" />
              </button>
              {AVATAR_EMOJI_OPTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setEditEmoji(emoji)}
                  className={`w-10 h-10 text-lg rounded-2xl flex items-center justify-center transition-all ${
                    editEmoji === emoji
                      ? 'bg-md-primary/15 border-2 border-md-primary scale-105'
                      : 'bg-md-surface-container-highest hover:bg-md-surface-variant'
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          {/* Display Name Input */}
          <Input
            label="Display Name"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Focus Practitioner"
            required
          />

          {/* Daily Goal Input */}
          <div>
            <Input
              label="Daily Target (minutes)"
              type="number"
              min="10"
              max="1440"
              step="5"
              value={editGoalMinutes}
              onChange={(e) => setEditGoalMinutes(Number(e.target.value))}
              helperText={`Equal to ${(editGoalMinutes / 60).toFixed(1)} hours of focus per day`}
              required
            />

            {/* Quick goal presets */}
            <div className="flex items-center gap-1.5 mt-2">
              {[60, 90, 120, 180, 240].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setEditGoalMinutes(mins)}
                  className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors ${
                    editGoalMinutes === mins
                      ? 'bg-md-primary text-md-on-primary'
                      : 'bg-md-surface-variant text-md-on-surface-variant hover:bg-md-surface-container-highest'
                  }`}
                >
                  {mins / 60}h
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-md-outline-variant/20">
            <Button
              variant="text"
              size="sm"
              type="button"
              onClick={() => setIsEditingProfile(false)}
            >
              Cancel
            </Button>
            <Button variant="filled" size="sm" type="submit">
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>

      {/* Import Confirmation Modal */}
      <Modal
        isOpen={Boolean(pendingBackup)}
        onClose={() => setPendingBackup(null)}
        title="Confirm Data Import"
      >
        {pendingBackup && (
          <div className="flex flex-col gap-4 pt-1 text-xs">
            <p className="text-md-on-surface-variant">
              The selected file contains valid Pomodor data from{' '}
              <strong className="text-md-on-surface">
                {new Date(pendingBackup.exportedAt).toLocaleDateString()}
              </strong>
              .
            </p>

            {/* Summary preview */}
            <div className="p-3 rounded-2xl bg-md-surface-container flex flex-col gap-1.5 text-md-on-surface">
              <div className="flex items-center justify-between">
                <span>Sessions in file:</span>
                <span className="font-bold">{pendingBackup.sessions?.length || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Tags in file:</span>
                <span className="font-bold">{pendingBackup.tags?.length || 0}</span>
              </div>
              {pendingBackup.profile?.displayName && (
                <div className="flex items-center justify-between">
                  <span>Profile name:</span>
                  <span className="font-bold">{pendingBackup.profile.displayName}</span>
                </div>
              )}
            </div>

            {/* Import Mode Selection */}
            <div className="flex flex-col gap-2">
              <label className="font-semibold text-md-on-surface">Choose import method:</label>

              <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-md-outline-variant/30 hover:bg-md-surface-container cursor-pointer transition-colors">
                <input
                  type="radio"
                  name="importMode"
                  value="merge"
                  checked={importMode === 'merge'}
                  onChange={() => setImportMode('merge')}
                  className="mt-0.5 accent-md-primary"
                />
                <div>
                  <span className="font-bold text-md-on-surface block">
                    Merge with existing data (Recommended)
                  </span>
                  <span className="text-md-on-surface-variant text-[11px]">
                    Preserves your current tags and sessions, and adds non-duplicate records from the file.
                  </span>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-md-outline-variant/30 hover:bg-md-surface-container cursor-pointer transition-colors">
                <input
                  type="radio"
                  name="importMode"
                  value="replace"
                  checked={importMode === 'replace'}
                  onChange={() => setImportMode('replace')}
                  className="mt-0.5 accent-md-primary"
                />
                <div>
                  <span className="font-bold text-md-error block">
                    Replace existing data
                  </span>
                  <span className="text-md-on-surface-variant text-[11px]">
                    Completely overwrites all your current sessions, tags, and settings with the file's data.
                  </span>
                </div>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-md-outline-variant/20">
              <Button
                variant="text"
                size="sm"
                onClick={() => setPendingBackup(null)}
              >
                Cancel
              </Button>
              <Button variant="filled" size="sm" onClick={handleConfirmImport}>
                Import Now
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Danger Zone Confirmation Modal */}
      <Modal
        isOpen={Boolean(resetModalScope)}
        onClose={() => setResetModalScope(null)}
        title={
          resetModalScope === 'sessions-only'
            ? 'Clear Session History?'
            : 'Factory Reset Application?'
        }
      >
        <div className="flex flex-col gap-4 pt-1 text-xs">
          <div className="p-3 rounded-2xl bg-md-error-container/20 border border-md-error/30 text-md-on-surface">
            {resetModalScope === 'sessions-only' ? (
              <p>
                Are you sure you want to permanently clear all completed focus sessions? Your custom tags, profile, and timer settings will remain untouched.
              </p>
            ) : (
              <p>
                <strong>Warning:</strong> This will permanently delete all session logs and restore tags, settings, and profile to their original defaults. This cannot be undone.
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-md-outline-variant/20">
            <Button
              variant="text"
              size="sm"
              onClick={() => setResetModalScope(null)}
            >
              Cancel
            </Button>
            <Button
              variant="filled"
              size="sm"
              className="bg-md-error hover:bg-red-700 text-white"
              onClick={handleConfirmReset}
            >
              {resetModalScope === 'sessions-only' ? 'Clear Sessions' : 'Reset Everything'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
