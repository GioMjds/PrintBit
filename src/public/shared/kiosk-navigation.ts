export type KioskNavigationMode = 'assign' | 'replace';

export function resolveSameOriginNavigation(
  href: string,
  currentHref: string,
): string | null {
  try {
    const current = new URL(currentHref);
    const target = new URL(href, current);
    const sameDocument =
      target.pathname === current.pathname && target.search === current.search;

    if (
      !['http:', 'https:'].includes(target.protocol) ||
      target.origin !== current.origin ||
      sameDocument
    ) {
      return null;
    }

    return target.href;
  } catch {
    return null;
  }
}

export function kioskNavigationDelay(prefersReducedMotion: boolean): number {
  return prefersReducedMotion ? 90 : 170;
}

export function navigateWithKioskMotion(
  href: string,
  mode: KioskNavigationMode = 'assign',
): boolean {
  const destination = resolveSameOriginNavigation(href, window.location.href);
  if (!destination) return false;

  const root = document.documentElement;
  if (root.dataset.kioskNavigationPending === 'true') return true;

  root.dataset.kioskMotion = 'ready';
  root.dataset.kioskNavigationPending = 'true';
  root.dataset.kioskPageState = 'leaving';

  const delay = kioskNavigationDelay(
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  window.setTimeout(() => window.location[mode](destination), delay);
  return true;
}
