import { useCallback, useMemo } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { isConvexConfigured, convexClient, getValidAuthToken } from './ConvexClient';

export function useConvexSync(isAuthenticated: boolean) {
  const shouldQuery = isConvexConfigured && isAuthenticated;

  // Only query Convex if Convex URL is configured and user is authenticated
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

  const setAuthToken = useCallback((token: string | null) => {
    if (!isConvexConfigured) return;

    try {
      if (!token) {
        try {
          convexClient.clearAuth();
        } catch (err) {
          console.warn('Convex clearAuth error:', err);
        }
        convexClient.setAuth(async () => undefined);
        return;
      }

      convexClient.setAuth(
        async (args?: { forceRefreshToken?: boolean }) => {
          try {
            return getValidAuthToken(token, args);
          } catch (err) {
            console.warn('Error in Convex auth token fetcher:', err);
            return undefined;
          }
        },
        (isAuthenticatedState: boolean) => {
          if (!isAuthenticatedState) {
            console.warn('Convex authentication state: unauthenticated');
          }
        },
        (isRefreshing: boolean) => {
          if (isRefreshing) {
            console.info('Convex WebSocket auth token refresh in progress...');
          }
        }
      );
    } catch (err) {
      console.warn('Convex setAuth error:', err);
    }
  }, []);

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
      wrapMutation,
    ]
  );

  return {
    isConvexConfigured,
    convexUser,
    convexCoffee,
    convexSessions,
    setAuthToken,
    mutations,
  };
}

