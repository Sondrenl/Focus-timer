import { useCallback, useMemo } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { isConvexConfigured, convexClient } from '../services/convex/ConvexClient';

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
  const recordSessionMutation = useMutation(api.sessions.record);
  const clearSessionsMutation = useMutation(api.sessions.clear);
  const addCupMutation = useMutation(api.coffee.addCup);
  const removeCupMutation = useMutation(api.coffee.removeCup);
  const clearCoffeeMutation = useMutation(api.coffee.clear);
  const importBackupMutation = useMutation(api.migrations.importBackup);

  const setAuthToken = useCallback((token: string | null) => {
    if (isConvexConfigured) {
      convexClient.setAuth(async () => token);
    }
  }, []);

  const mutations = useMemo(
    () => ({
      updateProfile: updateProfileMutation,
      updateSettings: updateSettingsMutation,
      createTag: createTagMutation,
      updateTag: updateTagMutation,
      removeTag: removeTagMutation,
      recordSession: recordSessionMutation,
      clearSessions: clearSessionsMutation,
      addCup: addCupMutation,
      removeCup: removeCupMutation,
      clearCoffee: clearCoffeeMutation,
      importBackup: importBackupMutation,
    }),
    [
      updateProfileMutation,
      updateSettingsMutation,
      createTagMutation,
      updateTagMutation,
      removeTagMutation,
      recordSessionMutation,
      clearSessionsMutation,
      addCupMutation,
      removeCupMutation,
      clearCoffeeMutation,
      importBackupMutation,
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
