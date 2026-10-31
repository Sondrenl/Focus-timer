import { useMemo } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { isConvexConfigured } from '../services/convex/ConvexClient';

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
  const updatePresenceMutation = useMutation(api.timer.updatePresence);

  const mutations = useMemo(
    () => ({
      startTimer: startTimerMutation,
      pauseTimer: pauseTimerMutation,
      resumeTimer: resumeTimerMutation,
      resetTimer: resetTimerMutation,
      updatePresence: updatePresenceMutation,
    }),
    [
      startTimerMutation,
      pauseTimerMutation,
      resumeTimerMutation,
      resetTimerMutation,
      updatePresenceMutation,
    ]
  );

  return {
    isConvexConfigured,
    remoteTimer,
    mutations,
  };
}
