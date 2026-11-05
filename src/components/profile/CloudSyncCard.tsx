import React, { useState, useRef, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Cloud, LogOut, RefreshCw } from 'lucide-react';
import { AuthState } from '../../types/user';

interface CloudSyncCardProps {
  auth: AuthState;
  loginWithGoogle: (credential: string) => Promise<void>;
  logout: () => void;
  syncWithCloud: (force?: boolean) => Promise<void>;
}

export const CloudSyncCard: React.FC<CloudSyncCardProps> = ({
  auth,
  loginWithGoogle,
  logout,
  syncWithCloud,
}) => {
  const googleButtonContainerRef = useRef<HTMLDivElement>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.isAuthenticated && !auth.isTokenExpired) return;

    const renderGoogleBtn = () => {
      if (window.google?.accounts?.id && googleButtonContainerRef.current) {
        try {
          window.google.accounts.id.initialize({
            client_id:
              import.meta.env.VITE_GOOGLE_CLIENT_ID ||
              '229654613287-8utvd3fhrcsalh1ol02ev2mlg140kbai.apps.googleusercontent.com',
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
  }, [auth.isAuthenticated, auth.isTokenExpired, loginWithGoogle]);

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

        {auth.isAuthenticated && (
          <Button
            variant="tonal"
            size="sm"
            onClick={() => syncWithCloud(true)}
            disabled={auth.isSyncing}
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
            <p className="text-sm font-semibold text-md-on-surface">
              {auth.isTokenExpired ? 'Google Session Expired' : 'Back up and sync across devices'}
            </p>
            <p className="text-xs text-md-on-surface-variant mt-0.5">
              {auth.isTokenExpired
                ? 'Google tokens expire after 1 hour for security. Tap Continue with Google to renew your session and sync statistics.'
                : 'Sign in with Google to synchronize your active timer, completed sessions, and custom tags.'}
            </p>
            {authError && <p className="text-xs text-md-error mt-1">{authError}</p>}
          </div>
          <div ref={googleButtonContainerRef} className="shrink-0" />
        </div>
      )}
    </Card>
  );
};
