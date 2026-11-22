import { useMemo } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { isConvexConfigured } from './ConvexClient';

export function useConvexTimer(isAuthenticated: boolean, isAuthReady: boolean = true) {
  const shouldQuery = isConvexConfigured && isAuthenticated && isAuthReady;

  const remoteTimer = useQuery(
    api.timer.getActive,
    shouldQuery ? {} : 'skip'
  );

  const startTimerMutation = useMutation(api.timer.start);
  const pauseTimerMutation = useMutation(api.timer.pause);
  const resetTimerMutation = useMutation(api.timer.reset);
  const completeTimerMutation = useMutation(api.timer.complete);
  const updateTagTimerMutation = useMutation(api.timer.updateTag);

  const mutations = useMemo(
    () => ({
      startTimer: startTimerMutation,
      pauseTimer: pauseTimerMutation,
      resetTimer: resetTimerMutation,
      completeTimer: completeTimerMutation,
      updateTag: updateTagTimerMutation,
    }),
    [
      startTimerMutation,
      pauseTimerMutation,
      resetTimerMutation,
      completeTimerMutation,
      updateTagTimerMutation,
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
