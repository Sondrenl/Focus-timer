import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { ProfileSummaryCard } from './ProfileSummaryCard';
import { CloudSyncCard } from './CloudSyncCard';
import { DataManagementCard } from './DataManagementCard';
import { DangerZoneCard } from './DangerZoneCard';

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
    reloadSampleData,
    isDemoEnvironment,
    auth,
    isEffectiveAuthenticated,
    loginWithGoogle,
    logout,
    syncWithCloud,
  } = useApp();

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  return (
    <div className="w-full max-w-3xl mx-auto py-6 px-4 flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-md-on-surface">User Profile & Data</h2>
      </div>

      <ProfileSummaryCard
        profile={profile}
        updateProfile={updateProfile}
        sessions={sessions}
        tags={tags}
        isAuthenticated={isEffectiveAuthenticated}
        userEmail={auth.user?.email || profile.email}
      />

      <CloudSyncCard
        auth={{ ...auth, isAuthenticated: isEffectiveAuthenticated }}
        loginWithGoogle={loginWithGoogle}
        logout={logout}
        syncWithCloud={syncWithCloud}
      />

      <DataManagementCard
        exportBackup={exportBackup}
        importBackup={importBackup}
        reloadSampleData={reloadSampleData}
        isDemoEnvironment={isDemoEnvironment}
        isAuthenticated={isEffectiveAuthenticated}
        statusMessage={statusMessage}
        errorMessage={errorMessage}
        onStatusMessage={setStatusMessage}
        onErrorMessage={setErrorMessage}
      />

      <DangerZoneCard
        sessions={sessions}
        tags={tags}
        coffeeCups={coffeeCups}
        profile={profile}
        isAuthenticated={isEffectiveAuthenticated}
        resetAllData={resetAllData}
        onStatusMessage={setStatusMessage}
        onErrorMessage={setErrorMessage}
      />
    </div>
  );
};
