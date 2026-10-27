/**
 * Returns Tailwind CSS class string for intensity shading of calendar/grid cells.
 * Uses stepped opacities of md-primary based on the ratio against maximum seconds.
 */
export function getActivityIntensityStyle(
  seconds: number,
  maxSeconds: number,
  isSelected: boolean
): string {
  if (seconds === 0) {
    return isSelected
      ? 'bg-md-surface-container-high border-md-primary/50 text-md-on-surface ring-2 ring-md-primary/30'
      : 'bg-md-surface-container/30 border-transparent text-md-on-surface-variant/60 hover:bg-md-surface-container/60 hover:border-md-outline-variant/30';
  }

  const effectiveMax = Math.max(1, maxSeconds);
  const ratio = seconds / effectiveMax;

  if (ratio >= 0.75) {
    return isSelected
      ? 'bg-md-primary text-md-on-primary border-md-primary ring-2 ring-md-primary/40 font-bold shadow-xs'
      : 'bg-md-primary text-md-on-primary border-transparent font-bold hover:brightness-105 shadow-xs';
  }
  if (ratio >= 0.45) {
    return isSelected
      ? 'bg-md-primary/65 text-white border-md-primary ring-2 ring-md-primary/40 font-bold shadow-xs'
      : 'bg-md-primary/55 text-white border-transparent font-bold hover:bg-md-primary/65';
  }
  if (ratio >= 0.2) {
    return isSelected
      ? 'bg-md-primary/35 text-md-on-surface border-md-primary ring-2 ring-md-primary/40 font-semibold'
      : 'bg-md-primary/25 text-md-on-surface border-transparent font-semibold hover:bg-md-primary/35';
  }
  return isSelected
    ? 'bg-md-primary/20 text-md-on-surface border-md-primary ring-2 ring-md-primary/40 font-medium'
    : 'bg-md-primary/15 text-md-on-surface border-transparent font-medium hover:bg-md-primary/20';
}
