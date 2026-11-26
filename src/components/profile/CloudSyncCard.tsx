import React from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Cloud, LogOut, RefreshCw } from 'lucide-react';
import { AuthState } from '../../types/user';

interface CloudSyncCardProps {
  auth: AuthState;
  isLoggingOut?: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => void;
  syncWithCloud: () => Promise<void>;
}

export const CloudSyncCard: React.FC<CloudSyncCardProps> = ({
  auth,
  isLoggingOut = false,
  loginWithGoogle,
  logout,
  syncWithCloud,
}) => {
  return (
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

        {auth.isAuthenticated && !auth.isTokenExpired && (
          <Button
            variant="tonal"
            size="sm"
            onClick={() => syncWithCloud()}
            disabled={auth.isSyncing || isLoggingOut}
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${auth.isSyncing ? 'animate-spin' : ''}`} />
            <span>{auth.isSyncing ? 'Syncing...' : 'Sync Now'}</span>
          </Button>
        )}
      </div>

      {auth.isAuthenticated && !auth.isTokenExpired ? (
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
            <Button
              variant="outlined"
              size="sm"
              onClick={logout}
              disabled={isLoggingOut}
              className="text-md-error hover:bg-md-error/10"
            >
              <LogOut className="w-3.5 h-3.5 mr-1.5" />
              {isLoggingOut ? 'Signing Out...' : 'Sign Out'}
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
            <p className="text-sm font-semibold text-md-on-surface">
              {auth.isTokenExpired ? 'Cloud Session Expired' : 'Back up and sync across devices'}
            </p>
            <p className="text-xs text-md-on-surface-variant mt-0.5">
              {auth.isTokenExpired
                ? 'Your cloud session has expired. Tap Continue with Google to renew your session and resume syncing.'
                : 'Sign in with Google to synchronize your active timer, completed sessions, and custom tags.'}
            </p>
            {auth.syncError && <p className="text-xs text-md-error mt-1">{auth.syncError}</p>}
          </div>
          <Button
            variant="outlined"
            size="md"
            onClick={() => void loginWithGoogle()}
            disabled={auth.isSyncing}
            className="shrink-0 bg-white text-[#1f1f1f] border-[#747775]/40 hover:bg-[#f8f9fa]"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            <span>{auth.isSyncing ? 'Connecting...' : 'Continue with Google'}</span>
          </Button>
        </div>
      )}
    </Card>
  );
};
