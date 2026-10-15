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
  const hostname = window.location.hostname;

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

  // Default to false (preview/staging) for unknown branches or custom preview domains
  return false;
}

export function isPreviewOrDev(): boolean {
  return !isProduction();
}

export function getEnvironmentType(): 'production' | 'preview' | 'development' {
  if (typeof window === 'undefined') return 'production';
  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'development';
  if (isProduction()) return 'production';
  return 'preview';
}
