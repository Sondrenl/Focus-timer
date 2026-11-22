import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useConvexConnectionState } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { isConvexConfigured, convexClient } from './ConvexClient';
import { DEVICE_ID } from '../../context/timer/timerPersistence';

export function useConvexSync(isAuthenticated: boolean, isAuthReady: boolean = isAuthenticated) {
  const shouldQuery = isConvexConfigured && isAuthenticated && isAuthReady;
  const connectionState = useConvexConnectionState();
  const isConvexConnected = isConvexConfigured && connectionState.isWebSocketConnected;

  // Only query Convex once Convex URL is configured AND WebSocket auth is genuinely ready
  const convexUser = useQuery(
    api.users.current,
    shouldQuery ? {} : 'skip'
  );

  const convexCoffee = useQuery(
    api.coffee.list,
    shouldQuery ? {} : 'skip'
  );

  const convexSessions = useQuery(
    api.sessions.list,
    shouldQuery ? {} : 'skip'
  );

  const vapidPublicKey = useQuery(
    api.push.getVapidPublicKey,
    shouldQuery ? {} : 'skip'
  );

  const devicePushStatus = useQuery(
    api.push.getDeviceSubscriptionStatus,
    shouldQuery ? { deviceId: DEVICE_ID } : 'skip'
  );

  // Mutations
  const updateProfileMutation = useMutation(api.users.updateProfile);
  const updateSettingsMutation = useMutation(api.users.updateSettings);
  const createTagMutation = useMutation(api.tags.create);
  const updateTagMutation = useMutation(api.tags.update);
  const removeTagMutation = useMutation(api.tags.remove);
  const resetTagsMutation = useMutation(api.tags.resetToDefaults);
  const recordSessionMutation = useMutation(api.sessions.record);
  const clearSessionsMutation = useMutation(api.sessions.clear);
  const addCupMutation = useMutation(api.coffee.addCup);
  const removeCupMutation = useMutation(api.coffee.removeCup);
  const clearCoffeeMutation = useMutation(api.coffee.clear);
  const clearForReplaceBatchMutation = useMutation(api.migrations.clearForReplaceBatch);
  const importBackupMutation = useMutation(api.migrations.importBackup);
  const upsertAttemptMutation = useMutation(api.telemetry.upsertAttempt);
  const recordTelemetryEventsMutation = useMutation(api.telemetry.recordEvents);
  const discardTelemetryAttemptMutation = useMutation(api.telemetry.discardAttempt);
  const clearTelemetryMutation = useMutation(api.telemetry.clear);
  const registerPushSubscriptionMutation = useMutation(api.push.register);
  const unregisterPushSubscriptionMutation = useMutation(api.push.unregister);
  const scheduleTestPushMutation = useMutation(api.push.scheduleTestPush);

  const fetchTelemetryAttempts = useCallback(
    async (
      options: number | { limit?: number; startDate?: string; endDate?: string } = 5000
    ) => {
      if (!isConvexConfigured || !isAuthenticated || !isAuthReady) return null;
      const resolved =
        typeof options === 'number' ? { limit: options } : options;
      const limit = resolved.limit ?? 5000;
      try {
        return await convexClient.query(api.telemetry.listAttempts, {
          limit,
          ...(resolved.startDate ? { startDate: resolved.startDate } : {}),
          ...(resolved.endDate ? { endDate: resolved.endDate } : {}),
        });
      } catch (err) {
        console.warn('Convex listAttempts query error:', err);
        return null;
      }
    },
    [isAuthenticated, isAuthReady]
  );

  const fetchTelemetryEvents = useCallback(
    async (
      options: number | { limit?: number; startDate?: string; endDate?: string } = 5000
    ) => {
      if (!isConvexConfigured || !isAuthenticated || !isAuthReady) return null;
      const resolved =
        typeof options === 'number' ? { limit: options } : options;
      const limit = resolved.limit ?? 5000;
      try {
        return await convexClient.query(api.telemetry.listEvents, {
          limit,
          ...(resolved.startDate ? { startDate: resolved.startDate } : {}),
          ...(resolved.endDate ? { endDate: resolved.endDate } : {}),
        });
      } catch (err) {
        console.warn('Convex listEvents query error:', err);
        return null;
      }
    },
    [isAuthenticated, isAuthReady]
  );

  const wrapMutation = useCallback(
    <TArgs extends any[], TReturn>(
      mutationFn: (...args: TArgs) => Promise<TReturn>,
      name: string
    ) => {
      return async (...args: TArgs): Promise<TReturn> => {
        try {
          return await mutationFn(...args);
        } catch (err) {
          console.warn(`Convex mutation error in ${name}:`, err);
          throw err;
        }
      };
    },
    []
  );

  const mutations = useMemo(
    () => ({
      updateProfile: wrapMutation(updateProfileMutation, 'updateProfile'),
      updateSettings: wrapMutation(updateSettingsMutation, 'updateSettings'),
      createTag: wrapMutation(createTagMutation, 'createTag'),
      updateTag: wrapMutation(updateTagMutation, 'updateTag'),
      removeTag: wrapMutation(removeTagMutation, 'removeTag'),
      resetTags: wrapMutation(resetTagsMutation, 'resetTags'),
      recordSession: wrapMutation(recordSessionMutation, 'recordSession'),
      clearSessions: wrapMutation(clearSessionsMutation, 'clearSessions'),
      addCup: wrapMutation(addCupMutation, 'addCup'),
      removeCup: wrapMutation(removeCupMutation, 'removeCup'),
      clearCoffee: wrapMutation(clearCoffeeMutation, 'clearCoffee'),
      clearForReplaceBatch: wrapMutation(clearForReplaceBatchMutation, 'clearForReplaceBatch'),
      importBackup: wrapMutation(importBackupMutation, 'importBackup'),
      upsertAttempt: wrapMutation(upsertAttemptMutation, 'upsertAttempt'),
      recordTelemetryEvents: wrapMutation(recordTelemetryEventsMutation, 'recordTelemetryEvents'),
      discardTelemetryAttempt: wrapMutation(discardTelemetryAttemptMutation, 'discardTelemetryAttempt'),
      clearTelemetry: wrapMutation(clearTelemetryMutation, 'clearTelemetry'),
      registerPushSubscription: wrapMutation(registerPushSubscriptionMutation, 'registerPushSubscription'),
      unregisterPushSubscription: wrapMutation(unregisterPushSubscriptionMutation, 'unregisterPushSubscription'),
      scheduleTestPush: wrapMutation(scheduleTestPushMutation, 'scheduleTestPush'),
    }),
    [
      updateProfileMutation,
      updateSettingsMutation,
      createTagMutation,
      updateTagMutation,
      removeTagMutation,
      resetTagsMutation,
      recordSessionMutation,
      clearSessionsMutation,
      addCupMutation,
      removeCupMutation,
      clearCoffeeMutation,
      clearForReplaceBatchMutation,
      importBackupMutation,
      upsertAttemptMutation,
      recordTelemetryEventsMutation,
      discardTelemetryAttemptMutation,
      clearTelemetryMutation,
      registerPushSubscriptionMutation,
      unregisterPushSubscriptionMutation,
      scheduleTestPushMutation,
      wrapMutation,
    ]
  );

  return useMemo(
    () => ({
      isConvexConfigured,
      isConvexConnected,
      convexUser,
      convexCoffee,
      convexSessions,
      vapidPublicKey,
      devicePushStatus,
      fetchTelemetryAttempts,
      fetchTelemetryEvents,
      mutations,
    }),
    [
      isConvexConnected,
      convexUser,
      convexCoffee,
      convexSessions,
      vapidPublicKey,
      devicePushStatus,
      fetchTelemetryAttempts,
      fetchTelemetryEvents,
      mutations,
    ]
  );
}

