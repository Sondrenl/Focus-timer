/**
 * Utility for detecting whether the application is running in production,
 * a Cloudflare preview deployment, or local development.
 */
export function isProduction(): boolean {
  if (typeof window === 'undefined') return true;

  // 1. Explicit build variable if set in Cloudflare / Vite
  if (import.meta.env.VITE_APP_ENV === 'production') return true;
  if (import.meta.env.VITE_APP_ENV === 'preview') return false;

  // 2. Hostname runtime detection
  const hostname = window.location.hostname.toLowerCase();

  // Local development
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.local')
  ) {
    return false;
  }

  // Cloudflare deployments (*.workers.dev)
  if (hostname.endsWith('.workers.dev')) {
    // Only the exact root production URL is production
    // e.g. "focus-timer.sondrelassen.workers.dev" is production
    // "feature-user-profile-and-data-focus-timer.sondrelassen.workers.dev" is preview
    return hostname === 'focus-timer.sondrelassen.workers.dev';
  }

  // Check subdomain/domain labels excluding the TLD so custom .dev production domains
  // (e.g. "pomodor.dev") are treated as production while "dev.pomodor.dev" is not.
  const labels = hostname.split('.').slice(0, -1);
  const nonProdTokens = new Set(['dev', 'preview', 'stage', 'staging']);
  const hasNonProdLabel = labels.some((label) =>
    label.split('-').some((token) => nonProdTokens.has(token))
  );

  if (import.meta.env.PROD && !hasNonProdLabel) {
    return true;
  }
  return false;
}

export function isPreviewOrDev(): boolean {
  return !isProduction();
}

/**
 * Detects if the current user agent / device is mobile or touch-primary
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) {
    return true;
  }
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints && navigator.maxTouchPoints > 1) {
    return true;
  }
  return false;
}
