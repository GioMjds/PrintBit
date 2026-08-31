const MOBILE_VIEWPORT_QUERY = '(max-width: 780px)';

/** Returns true when the current viewport is sized for a phone or tablet. */
export function isMobileViewport(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(MOBILE_VIEWPORT_QUERY).matches
  );
}
