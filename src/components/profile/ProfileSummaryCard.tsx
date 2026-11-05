import React, { useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { User, Edit2, Sparkles, CheckCircle2, Target } from 'lucide-react';
import { UserProfile } from '../../types/user';
import { CompletedSession } from '../../types/session';
import { Tag } from '../../types/tag';
import { formatDurationHoursMins } from '../../utils/formatters';
import { toDateKey } from '../../utils/dates';

const AVATAR_EMOJI_OPTIONS = [
  '🍅', '⚡', '☕', '🚀', '🧠', '🔥', '🎯', '📚', '💻', '🧘', '🌱', '⭐',
  '🦊', '🐱', '🦉', '🐻', '🦁', '🐨', '🐼', '🦄', '🐝', '🐙', '🦖', '🍀',
];

interface ProfileSummaryCardProps {
  profile: UserProfile;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
  sessions: CompletedSession[];
  tags: Tag[];
  isAuthenticated: boolean;
  userEmail?: string;
}

export const ProfileSummaryCard: React.FC<ProfileSummaryCardProps> = ({
  profile,
  updateProfile,
  sessions,
  tags,
  isAuthenticated,
  userEmail,
}) => {
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState(isAuthenticated ? profile.displayName : 'Focus Practitioner');
  const [editEmoji, setEditEmoji] = useState(profile.avatarEmoji);
  const [editGoalMinutes, setEditGoalMinutes] = useState(profile.dailyGoalMinutes);

  const openEditModal = () => {
    setEditName(isAuthenticated ? profile.displayName : 'Focus Practitioner');
    setEditEmoji(profile.avatarEmoji);
    setEditGoalMinutes(profile.dailyGoalMinutes);
    setIsEditingProfile(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateProfile({
      displayName: editName.trim() || 'Focus Practitioner',
      avatarEmoji: editEmoji,
      dailyGoalMinutes: Number(editGoalMinutes) || 120,
    });
    setIsEditingProfile(false);
  };

  // Total Focus Time in seconds (Work sessions only)
  const totalFocusSeconds = sessions
    .filter((s) => s.sessionType === 'WORK')
    .reduce((acc, curr) => acc + curr.durationSeconds, 0);

  // Today's Focus Time in minutes (local calendar date)
  const todayStr = toDateKey(new Date());
  const todayFocusSeconds = sessions
    .filter((s) => s.sessionType === 'WORK' && toDateKey(s.completedAt) === todayStr)
    .reduce((acc, curr) => acc + curr.durationSeconds, 0);
  const todayFocusMinutes = Math.round(todayFocusSeconds / 60);
  const goalProgressPercent = Math.min(100, Math.round((todayFocusMinutes / (profile.dailyGoalMinutes || 120)) * 100));

  return (
    <>
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20 flex flex-col gap-5">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 text-center sm:text-left">
          {/* Avatar Icon */}
          <div className="relative group">
            <div className="w-20 h-20 rounded-3xl bg-md-primary/10 border-2 border-md-primary/30 flex items-center justify-center text-3xl shadow-xs select-none overflow-hidden">
              {profile.avatarEmoji ? (
                profile.avatarEmoji
              ) : isAuthenticated && profile.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt={isAuthenticated ? profile.displayName : 'Focus Practitioner'}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <User className="w-10 h-10 text-md-primary" />
              )}
            </div>
            <button
              onClick={openEditModal}
              className="absolute -bottom-1 -right-1 p-1.5 rounded-full bg-md-primary text-md-on-primary hover:bg-[#584192] transition-colors shadow-sm"
              title="Change Avatar & Profile"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-xl font-bold text-md-on-surface">
                  {isAuthenticated ? profile.displayName : 'Focus Practitioner'}
                </h3>
                {isAuthenticated && userEmail ? (
                  <span className="inline-flex items-center gap-1 text-xs text-md-on-surface-variant font-mono mt-0.5">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" /> {userEmail}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-md-primary mt-0.5">
                    <Sparkles className="w-3 h-3" /> Focus Account
                  </span>
                )}
              </div>

              <Button variant="outlined" size="sm" onClick={openEditModal}>
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
                    onClick={openEditModal}
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
    </>
  );
};
