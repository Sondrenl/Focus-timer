import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import {
  User,
  Download,
  Upload,
  RotateCcw,
  AlertTriangle,
  Check,
  Edit2,
  Trash2,
  Sparkles,
  Cloud,
  LogOut,
  RefreshCw,
  CheckCircle2,
  Target,
} from 'lucide-react';
import { BackupData } from '../../types/user';
import { formatDurationHoursMins } from '../../utils/formatters';

const AVATAR_EMOJI_OPTIONS = [
  '🍅', '⚡', '☕', '🚀', '🧠', '🔥', '🎯', '📚', '💻', '🧘', '🌱', '⭐',
  '🦊', '🐱', '🦉', '🐻', '🦁', '🐨', '🐼', '🦄', '🐝', '🐙', '🦖', '🍀',
];

export const ProfileView: React.FC = () => {
  const {
    profile,
    updateProfile,
    sessions,
    tags,
    coffeeCups,
    exportBackup,
    importBackup,
    resetAllData,
    auth,
    loginWithGoogle,
    logout,
    syncWithCloud,
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
  const [isResetting, setIsResetting] = useState(false);

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
            client_id: '229654613287-8utvd3fhrcsalh1ol02ev2mlg140kbai.apps.googleusercontent.com',
            callback: async (response: any) => {
              if (response.credential) {
                try {
                  setAuthError(null);
                  await loginWithGoogle(response.credential);
                } catch (err: any) {
                  setAuthError(err.message || 'Google sign-in failed');
                }
              }
            },
          });

          window.google.accounts.id.renderButton(googleButtonContainerRef.current, {
            type: 'standard',
            theme: 'outline',
            size: 'large',
            text: 'continue_with',
            shape: 'pill',
            logo_alignment: 'left',
          });
        } catch (e) {
          console.warn('Google Identity button initialization failed', e);
        }
      }
    };

    renderGoogleBtn();
    const interval = setInterval(() => {
      if (window.google?.accounts?.id && googleButtonContainerRef.current) {
        renderGoogleBtn();
        clearInterval(interval);
      }
    }, 300);

    return () => clearInterval(interval);
  }, [auth.isAuthenticated, loginWithGoogle]);

  // Total Focus Time in seconds (Work sessions only)
  const totalFocusSeconds = sessions
    .filter((s) => s.sessionType === 'WORK')
    .reduce((acc, curr) => acc + curr.durationSeconds, 0);

  // Today's Focus Time in minutes
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayFocusSeconds = sessions
    .filter((s) => s.sessionType === 'WORK' && s.completedAt.startsWith(todayStr))
    .reduce((acc, curr) => acc + curr.durationSeconds, 0);
  const todayFocusMinutes = Math.round(todayFocusSeconds / 60);
  const goalProgressPercent = Math.min(100, Math.round((todayFocusMinutes / (profile.dailyGoalMinutes || 120)) * 100));

  // Trigger JSON file download
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
        const hasCoffee = Array.isArray(parsed.coffeeCups);

        if (!hasTags && !hasSessions && !hasCoffee) {
          throw new Error('File does not appear to be a valid Focus Timer backup.');
        }

        setPendingBackup({
          version: parsed.version || '2.2.0',
          exportedAt: parsed.exportedAt || new Date().toISOString(),
          profile: parsed.profile,
          settings: parsed.settings,
          tags: parsed.tags || [],
          sessions: parsed.sessions || [],
          coffeeCups: parsed.coffeeCups || [],
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
      const parts = [
        `${result.sessionsAdded} sessions`,
        `${result.tagsAdded} tags`,
      ];
      if (typeof result.coffeeAdded === 'number') {
        parts.push(`${result.coffeeAdded} coffee cups`);
      }
      setImportSuccessMessage(
        `Import complete! Restored ${parts.join(', ')}.`
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
    if (!resetModalScope || isResetting) return;
    const scope = resetModalScope;
    setIsResetting(true);
    try {
      await resetAllData(scope);
      setResetModalScope(null);
      setImportSuccessMessage(
        scope === 'sessions-only'
          ? 'Focus and coffee history permanently cleared.'
          : 'Factory reset complete! All data has been reset to defaults.'
      );
      setTimeout(() => setImportSuccessMessage(null), 4000);
    } catch {
      setImportError('An error occurred while resetting data.');
    } finally {
      setIsResetting(false);
    }
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
              <div>
                <p className="text-xs text-md-on-surface-variant font-medium">Logged in as</p>
                <p className="text-sm font-bold text-md-on-surface">{auth.user?.email}</p>
                {auth.lastSyncedAt && (
                  <p className="text-[11px] text-md-outline mt-0.5">
                    Last synced: {new Date(auth.lastSyncedAt).toLocaleTimeString()}
                  </p>
                )}
              </div>
              <Button variant="outlined" size="sm" onClick={logout} className="text-md-error hover:bg-md-error/10">
                <LogOut className="w-3.5 h-3.5 mr-1.5" />
                Sign Out
              </Button>
            </div>
            {auth.syncError && (
              <div className="p-2.5 rounded-xl bg-md-error/10 text-md-error text-xs">
                Sync Error: {auth.syncError}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-2 border-t border-md-outline-variant/15">
            <div>
              <p className="text-sm font-semibold text-md-on-surface">Back up and sync across devices</p>
              <p className="text-xs text-md-on-surface-variant mt-0.5">
                Sign in with Google to synchronize your active timer, completed sessions, and custom tags.
              </p>
              {authError && <p className="text-xs text-md-error mt-1">{authError}</p>}
            </div>
            <div ref={googleButtonContainerRef} className="shrink-0" />
          </div>
        )}
      </Card>

      {/* Export / Import Card */}
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

      {/* Danger Zone Confirmation Modal */}
      {resetModalScope && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-md-surface-container-lowest p-6 rounded-3xl max-w-md w-full border border-md-outline-variant/30 shadow-elevation-4 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-md-error/10 text-md-error flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-md-on-surface">
                  {resetModalScope === 'sessions-only' ? 'Clear Focus & Coffee History?' : 'Factory Reset All Data?'}
                </h3>
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
                  {auth.isAuthenticated && <span>• All remote cloud records for your account</span>}
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
        </div>
      )}
    </div>
  );
};
