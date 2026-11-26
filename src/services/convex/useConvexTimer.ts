import { useMemo } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { isConvexConfigured } from './ConvexClient';

export function useConvexTimer(isAuthenticated: boolean) {
  const shouldQuery = isConvexConfigured && isAuthenticated;

  const remoteTimer = useQuery(
    api.timer.getActive,
    shouldQuery ? {} : 'skip'
  );

  const startTimerMutation = useMutation(api.timer.start);
  const pauseTimerMutation = useMutation(api.timer.pause);
  const resetTimerMutation = useMutation(api.timer.reset);
  const updateTagTimerMutation = useMutation(api.timer.updateTag);
  const acknowledgeActiveMutation = useMutation(api.timer.acknowledgeActive);

  const mutations = useMemo(
    () => ({
      startTimer: startTimerMutation,
      pauseTimer: pauseTimerMutation,
      resetTimer: resetTimerMutation,
      updateTag: updateTagTimerMutation,
      acknowledgeActive: acknowledgeActiveMutation,
    }),
    [
      startTimerMutation,
      pauseTimerMutation,
      resetTimerMutation,
      updateTagTimerMutation,
      acknowledgeActiveMutation,
    ]
  );

  return useMemo(
    () => ({
      isConvexConfigured,
      remoteTimer,
      mutations,
    }),
    [remoteTimer, mutations]
  );
}
