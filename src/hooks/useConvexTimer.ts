import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { isConvexConfigured } from '../services/convex/ConvexClient';

export function useConvexTimer() {
  const remoteTimer = useQuery(
    api.timer.getActive,
    isConvexConfigured ? {} : 'skip'
  );

  const startTimerMutation = useMutation(api.timer.start);
  const pauseTimerMutation = useMutation(api.timer.pause);
  const resumeTimerMutation = useMutation(api.timer.resume);
  const resetTimerMutation = useMutation(api.timer.reset);
  const updatePresenceMutation = useMutation(api.timer.updatePresence);

  return {
    isConvexConfigured,
    remoteTimer,
    mutations: {
      startTimer: startTimerMutation,
      pauseTimer: pauseTimerMutation,
      resumeTimer: resumeTimerMutation,
      resetTimer: resetTimerMutation,
      updatePresence: updatePresenceMutation,
    },
  };
}
