import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useConvexConnectionState } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { isConvexConfigured } from './ConvexClient';
import { DEVICE_ID } from '../../context/timer/timerPersistence';

export function useConvexSync(isAuthenticated: boolean) {
  const shouldQuery = isConvexConfigured && isAuthenticated;
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
  const importBackupMutation = useMutation(api.migrations.importBackup);
  const upsertAttemptMutation = useMutation(api.telemetry.upsertAttempt);
  const clearTelemetryMutation = useMutation(api.telemetry.clear);
  const registerPushSubscriptionMutation = useMutation(api.push.register);
  const unregisterPushSubscriptionMutation = useMutation(api.push.unregister);
  const scheduleTestPushMutation = useMutation(api.push.scheduleTestPush);

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
      importBackup: wrapMutation(importBackupMutation, 'importBackup'),
      upsertAttempt: wrapMutation(upsertAttemptMutation, 'upsertAttempt'),
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
      importBackupMutation,
      upsertAttemptMutation,
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
      mutations,
    }),
    [
      isConvexConnected,
      convexUser,
      convexCoffee,
      convexSessions,
      vapidPublicKey,
      devicePushStatus,
      mutations,
    ]
  );
}
