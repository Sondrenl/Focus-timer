import React, { useState, useRef, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Cloud, LogOut, RefreshCw } from 'lucide-react';
import { AuthState } from '../../types/user';

interface CloudSyncCardProps {
  auth: AuthState;
  isLoggingOut?: boolean;
  pendingSyncCount?: number;
  loginWithGoogle: (credential: string) => Promise<void>;
  logout: () => void;
  syncWithCloud: () => Promise<void>;
}

const MAX_GIS_POLL_ATTEMPTS = 25;

export const CloudSyncCard: React.FC<CloudSyncCardProps> = ({
  auth,
  isLoggingOut = false,
  pendingSyncCount = 0,
  logout,
  syncWithCloud,
}) => {
  const googleButtonContainerRef = useRef<HTMLDivElement>(null);
  const [gisUnavailable, setGisUnavailable] = useState(false);

  useEffect(() => {
    if (auth.isAuthenticated && !auth.isTokenExpired) return;
    let attempts = 0;
    let interval: ReturnType<typeof setInterval> | null = null;
    let rendered = false;

    const tryRenderGoogleBtn = () => {
      if (rendered) return true;
      if (window.google?.accounts?.id && googleButtonContainerRef.current) {
        try {
          googleButtonContainerRef.current.innerHTML = '';
          window.google.accounts.id.renderButton(googleButtonContainerRef.current, {
            type: 'standard',
            theme: 'outline',
            size: 'large',
            text: 'continue_with',
            shape: 'pill',
            logo_alignment: 'left',
          });
          rendered = true;
          setGisUnavailable(false);
          return true;
        } catch (e) {
          console.warn('Google Identity button render failed', e);
        }
      }
      return false;
    };

    const startPolling = () => {
      if (tryRenderGoogleBtn()) return;
      if (interval) clearInterval(interval);
      attempts = 0;
      interval = setInterval(() => {
        attempts += 1;
        if (tryRenderGoogleBtn() || attempts >= MAX_GIS_POLL_ATTEMPTS) {
          if (interval) {
            clearInterval(interval);
            interval = null;
          }
          if (!rendered) {
            setGisUnavailable(true);
          }
        }
      }, 300);
    };

    startPolling();
    const handleOnline = () => {
      if (!rendered) {
        startPolling();
      }
    };
    window.addEventListener('online', handleOnline);

    return () => {
      if (interval) clearInterval(interval);
      window.removeEventListener('online', handleOnline);
    };
  }, [auth.isAuthenticated, auth.isTokenExpired]);

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
            <span>
              {auth.isSyncing
                ? 'Syncing...'
                : pendingSyncCount > 0
                  ? `Sync Now (${pendingSyncCount})`
                  : 'Sync Now'}
            </span>
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
              {pendingSyncCount > 0 && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                  {pendingSyncCount} offline change{pendingSyncCount === 1 ? '' : 's'} queued to sync
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
            {gisUnavailable && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                Google Sign-In could not load (you may be offline or blocking accounts.google.com).
              </p>
            )}
          </div>
          <div ref={googleButtonContainerRef} className="shrink-0" />
        </div>
      )}
    </Card>
  );
};
