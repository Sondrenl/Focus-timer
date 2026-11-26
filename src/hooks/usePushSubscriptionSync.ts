import { useState, useEffect, useCallback, useRef, MutableRefObject } from 'react';
import {
  NotificationService,
  PushRegisterPayload,
  PushSubscriptionStatus,
} from '../services/notification/NotificationService';
import { UserSettings } from '../types/settings';
import { DEVICE_ID } from '../context/timer/timerPersistence';
import { settingsRepository } from '../context/services';

const PUSH_RESYNC_TTL_MS = 15 * 60 * 1000;
const SERVER_PRUNE_RECOVERY_COOLDOWN_MS = 30 * 1000;
const SYNC_ERROR_RETRY_DELAYS_MS = [3_000, 8_000, 20_000];

interface UsePushSubscriptionSyncParams {
  notificationService: NotificationService;
  isConvexConfigured: boolean;
  isEffectiveAuthenticated: boolean;
  isConvexAuthReady?: boolean;
  isConvexConnected?: boolean;
  currentUserId?: string | null;
  isLoggingOutRef?: MutableRefObject<boolean>;
  notificationsEnabled: boolean;
  settingsRef: MutableRefObject<UserSettings>;
  vapidPublicKey?: string | null;
  isServerSubscriptionRegistered?: boolean;
  registerPushSubscription: (args: PushRegisterPayload) => Promise<unknown>;
  unregisterPushSubscription?: (args: { deviceId: string }) => Promise<unknown>;
}

export function usePushSubscriptionSync({
  notificationService,
  isConvexConfigured,
  isEffectiveAuthenticated,
  isConvexAuthReady = isEffectiveAuthenticated,
  isConvexConnected = true,
  currentUserId = null,
  isLoggingOutRef,
  notificationsEnabled,
  settingsRef,
  vapidPublicKey,
  isServerSubscriptionRegistered,
  registerPushSubscription,
  unregisterPushSubscription,
}: UsePushSubscriptionSyncParams) {
  const [pushStatus, setPushStatus] = useState<PushSubscriptionStatus>(() =>
    notificationService.getPushStatus()
  );
  const lastSyncedAtRef = useRef<number>(0);
  const lastPruneRecoveryAtRef = useRef<number>(0);
  const prevConnectedRef = useRef<boolean>(isConvexConnected);
  const isServerRegisteredRef = useRef<boolean | undefined>(isServerSubscriptionRegistered);
  isServerRegisteredRef.current = isServerSubscriptionRegistered;
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef<number>(0);

  const isAuthOperational = isConvexConfigured && isEffectiveAuthenticated && isConvexAuthReady;

  const clearScheduledRetry = useCallback(() => {
    if (retryTimeoutRef.current !== null) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => clearScheduledRetry, [clearScheduledRetry]);

  const isNotificationsEnabledLive = useCallback((): boolean => {
    if (!settingsRef.current.notificationsEnabled) return false;
    try {
      return Boolean(settingsRepository.getSync().notificationsEnabled);
    } catch {
      return Boolean(settingsRef.current.notificationsEnabled);
    }
  }, [settingsRef]);

  useEffect(() => {
    setPushStatus(notificationService.getPushStatus());
    return notificationService.subscribePushStatus((status) => {
      if (status !== 'active') {
        lastSyncedAtRef.current = 0;
      }
      setPushStatus(status);
    });
  }, [notificationService]);

  const handleMissingPermission = useCallback(
    (requireServerRegistered = true) => {
      clearScheduledRetry();
      retryAttemptRef.current = 0;
      lastSyncedAtRef.current = 0;
      const perm = notificationService.getPermissionState();
      notificationService.resetPushStatus(
        perm === 'unsupported'
          ? 'unsupported'
          : perm === 'denied'
            ? 'permission_denied'
            : 'unsubscribed'
      );
      if (
        perm === 'denied' &&
        (!requireServerRegistered || isServerRegisteredRef.current === true) &&
        unregisterPushSubscription
      ) {
        void unregisterPushSubscription({ deviceId: DEVICE_ID }).catch(() => {});
      }
    },
    [clearScheduledRetry, notificationService, unregisterPushSubscription]
  );

  const performSyncRef = useRef<() => Promise<{ ok: boolean; status: PushSubscriptionStatus; reason?: string }>>(
    async () => ({ ok: false, status: 'unsubscribed' })
  );

  const performSync = useCallback(async () => {
    clearScheduledRetry();
    if (isLoggingOutRef?.current || !isNotificationsEnabledLive()) {
      retryAttemptRef.current = 0;
      return {
        ok: false,
        status: 'unsubscribed' as PushSubscriptionStatus,
        reason: 'Notifications disabled or logging out',
      };
    }
    const result = await notificationService.syncPushSubscription({
      vapidPublicKey,
      deviceId: DEVICE_ID,
      registerFn: registerPushSubscription,
    });
    if (result.ok) {
      lastSyncedAtRef.current = Date.now();
      retryAttemptRef.current = 0;
    } else if (
      result.status === 'error' &&
      !isLoggingOutRef?.current &&
      isNotificationsEnabledLive() &&
      retryAttemptRef.current < SYNC_ERROR_RETRY_DELAYS_MS.length
    ) {
      const delayMs = SYNC_ERROR_RETRY_DELAYS_MS[retryAttemptRef.current];
      retryAttemptRef.current += 1;
      retryTimeoutRef.current = setTimeout(() => {
        retryTimeoutRef.current = null;
        void performSyncRef.current();
      }, delayMs);
    }
    return result;
  }, [
    clearScheduledRetry,
    notificationService,
    vapidPublicKey,
    registerPushSubscription,
    isLoggingOutRef,
    isNotificationsEnabledLive,
  ]);
  performSyncRef.current = performSync;

  const canAutoSync = useCallback((): boolean => {
    return Boolean(
      isAuthOperational &&
        !isLoggingOutRef?.current &&
        isNotificationsEnabledLive() &&
        vapidPublicKey &&
        notificationService.hasPermission()
    );
  }, [
    isAuthOperational,
    isLoggingOutRef,
    isNotificationsEnabledLive,
    vapidPublicKey,
    notificationService,
  ]);

  const syncPushSubscription = useCallback(async () => {
    if (!isAuthOperational || isLoggingOutRef?.current) {
      notificationService.resetPushStatus('unsubscribed');
      return { ok: false, status: 'unsubscribed' as PushSubscriptionStatus, reason: 'Unauthenticated' };
    }
    if (!isNotificationsEnabledLive()) {
      notificationService.resetPushStatus('unsubscribed');
      return {
        ok: false,
        status: 'unsubscribed' as PushSubscriptionStatus,
        reason: 'Notifications disabled',
      };
    }
    return performSync();
  }, [
    notificationService,
    isAuthOperational,
    isLoggingOutRef,
    isNotificationsEnabledLive,
    performSync,
  ]);

  // Register/refresh Web Push subscription when authenticated + notifications enabled
  useEffect(() => {
    if (!isAuthOperational || !notificationsEnabled || isLoggingOutRef?.current) {
      lastSyncedAtRef.current = 0;
      notificationService.resetPushStatus('unsubscribed');
      return;
    }
    if (vapidPublicKey === null) {
      lastSyncedAtRef.current = 0;
      notificationService.resetPushStatus('unconfigured');
      return;
    }
    if (!vapidPublicKey) return;
    if (!notificationService.hasPermission()) {
      handleMissingPermission(true);
      return;
    }

    void performSync();
  }, [
    notificationService,
    isAuthOperational,
    currentUserId,
    notificationsEnabled,
    vapidPublicKey,
    isLoggingOutRef,
    handleMissingPermission,
    performSync,
  ]);

  // Retry push sync when Convex WebSocket reconnects or if server pruned this device's push subscription
  useEffect(() => {
    const wasConnected = prevConnectedRef.current;
    prevConnectedRef.current = isConvexConnected;
    const justReconnected = !wasConnected && isConvexConnected;

    if (!canAutoSync()) return;

    if (
      justReconnected &&
      (notificationService.getPushStatus() !== 'active' || isServerRegisteredRef.current === false)
    ) {
      lastSyncedAtRef.current = 0;
      void performSync();
      return;
    }

    if (isServerSubscriptionRegistered === false && notificationsEnabled) {
      const now = Date.now();
      if (now - lastPruneRecoveryAtRef.current >= SERVER_PRUNE_RECOVERY_COOLDOWN_MS) {
        lastPruneRecoveryAtRef.current = now;
        lastSyncedAtRef.current = 0;
        void performSync();
      }
    }
  }, [
    isConvexConnected,
    isServerSubscriptionRegistered,
    notificationsEnabled,
    canAutoSync,
    notificationService,
    performSync,
  ]);

  // Re-sync on Service Worker pushsubscriptionchange / controllerchange
  useEffect(() => {
    return notificationService.subscribePushResyncRequested(() => {
      if (!canAutoSync()) return;
      lastSyncedAtRef.current = 0;
      void performSync();
    });
  }, [notificationService, canAutoSync, performSync]);

  // Listen to browser Permissions API onchange and focus/online/visibility return
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    let statusObj: PermissionStatus | null = null;

    const handlePermChange = () => {
      if (cancelled || !isAuthOperational || isLoggingOutRef?.current) return;
      if (notificationService.hasPermission()) {
        if (isNotificationsEnabledLive() && vapidPublicKey) {
          lastSyncedAtRef.current = 0;
          void performSync();
        }
      } else {
        handleMissingPermission(false);
      }
    };

    if (navigator?.permissions && typeof navigator.permissions.query === 'function') {
      navigator.permissions
        .query({ name: 'notifications' as PermissionName })
        .then((permStatus) => {
          if (cancelled) return;
          statusObj = permStatus;
          permStatus.addEventListener?.('change', handlePermChange);
        })
        .catch(() => {});
    }

    const handleReturn = async () => {
      if (document.visibilityState === 'hidden') return;
      if (
        !isAuthOperational ||
        isLoggingOutRef?.current ||
        !isNotificationsEnabledLive() ||
        !vapidPublicKey
      ) {
        return;
      }
      if (!notificationService.hasPermission()) {
        handleMissingPermission(true);
        return;
      }
      const serverMissing = isServerRegisteredRef.current === false;
      const endpointChanged = await notificationService.hasSubscriptionChanged();
      if (
        !serverMissing &&
        !endpointChanged &&
        notificationService.getPushStatus() === 'active' &&
        Date.now() - lastSyncedAtRef.current < PUSH_RESYNC_TTL_MS
      ) {
        return;
      }
      void performSync();
    };

    const onEvent = () => {
      void handleReturn();
    };
    window.addEventListener('focus', onEvent);
    window.addEventListener('online', onEvent);
    document.addEventListener('visibilitychange', onEvent);

    return () => {
      cancelled = true;
      statusObj?.removeEventListener?.('change', handlePermChange);
      window.removeEventListener('focus', onEvent);
      window.removeEventListener('online', onEvent);
      document.removeEventListener('visibilitychange', onEvent);
    };
  }, [
    notificationService,
    isAuthOperational,
    isLoggingOutRef,
    isNotificationsEnabledLive,
    vapidPublicKey,
    handleMissingPermission,
    performSync,
  ]);

  return {
    pushStatus,
    syncPushSubscription,
  };
}
