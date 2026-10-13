import { useTimerContext, TimerContextValue } from '../context/TimerContext';

/**
 * Hook providing access to global persistent timer engine.
 * State persists seamlessly across tab/view navigation and page reloads.
 */
export function useTimer(): TimerContextValue {
  return useTimerContext();
}
