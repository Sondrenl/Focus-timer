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
  const resumeTimerMutation = useMutation(api.timer.resume);
  const resetTimerMutation = useMutation(api.timer.reset);
  const completeTimerMutation = useMutation(api.timer.complete);
  const updatePresenceMutation = useMutation(api.timer.updatePresence);

  const mutations = useMemo(
    () => ({
      startTimer: startTimerMutation,
      pauseTimer: pauseTimerMutation,
      resumeTimer: resumeTimerMutation,
      resetTimer: resetTimerMutation,
      completeTimer: completeTimerMutation,
      updatePresence: updatePresenceMutation,
    }),
    [
      startTimerMutation,
      pauseTimerMutation,
      resumeTimerMutation,
      resetTimerMutation,
      completeTimerMutation,
      updatePresenceMutation,
    ]
  );

  return {
    isConvexConfigured,
    remoteTimer,
    mutations,
  };
}
