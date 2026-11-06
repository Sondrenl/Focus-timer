export const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Sanitizes an arbitrary color input into a validated safe hex color string.
 * Falls back to a safe default if input is invalid or contains unexpected characters.
 */
export function sanitizeHexColor(color?: string | null, fallback = '#3B82F6'): string {
  if (!color || typeof color !== 'string') return fallback;
  const trimmed = color.trim();
  return HEX_COLOR_REGEX.test(trimmed) ? trimmed : fallback;
}

/**
 * Returns a safe hex color with an alpha hex channel (e.g. '25' for ~15% opacity).
 * Properly expands 3-digit shorthand hex (#RGB -> #RRGGBB) before appending alpha hex
 * to prevent generating invalid 5-character CSS hex values.
 */
export function getAlphaColor(color?: string | null, alphaHex = '25', fallback = '#3B82F6'): string {
  const safe = sanitizeHexColor(color, fallback);
  if (safe.length === 4) {
    const r = safe[1];
    const g = safe[2];
    const b = safe[3];
    return `#${r}${r}${g}${g}${b}${b}${alphaHex}`;
  }
  if (safe.length === 7) {
    return `${safe}${alphaHex}`;
  }
  return safe;
}
