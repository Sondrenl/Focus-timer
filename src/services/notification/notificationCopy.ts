import { SessionType } from '../../types/timer';

/**
 * Returns the shared title and body copy for a completed timer interval notification.
 */
export function getCompletionNotificationCopy(sessionType: SessionType): {
  title: string;
  body: string;
} {
  if (sessionType === 'WORK') {
    return {
      title: 'Pomodor — Focus session complete',
      body: 'Your focus timer has finished. Time for a break.',
    };
  }
  return {
    title: 'Pomodor — Break session complete',
    body: 'Your break timer has finished. Time for a focus session.',
  };
}
