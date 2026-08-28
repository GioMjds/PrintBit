export type KioskNavigationMode = 'assign' | 'replace';

const KIOSK_NAVIGATION_DELAY_MS = 260;

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

export function navigateWithKioskMotion(
  href: string,
  mode: KioskNavigationMode = 'assign',
): boolean {
  const destination = resolveSameOriginNavigation(href, window.location.href);
  if (!destination) return false;

  const root = document.documentElement;
  if (root.dataset.kioskNavigationPending === 'true') return true;

  const prefersReducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches;
  if (prefersReducedMotion) {
    window.location[mode](destination);
    return true;
  }

  root.dataset.kioskNavigationPending = 'true';
  root.dataset.kioskPageState = 'leaving';
  window.setTimeout(
    () => window.location[mode](destination),
    KIOSK_NAVIGATION_DELAY_MS,
  );
  return true;
}

function handlePageNavigation(event: MouseEvent): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return;
  }

  const eventTarget = event.target;
  const anchor =
    eventTarget instanceof Element
      ? eventTarget.closest<HTMLAnchorElement>('a[href]')
      : null;
  if (
    !anchor ||
    anchor.hasAttribute('download') ||
    (anchor.target && anchor.target !== '_self')
  ) {
    return;
  }

  const destination = resolveSameOriginNavigation(
    anchor.href,
    window.location.href,
  );
  if (!destination) return;

  event.preventDefault();
  navigateWithKioskMotion(destination);
}

export function initKioskNavigation(): void {
  const root = document.documentElement;
  if (root.dataset.kioskNavigationInitialized === 'true') return;

  root.dataset.kioskNavigationInitialized = 'true';
  document.addEventListener('click', handlePageNavigation);
  window.addEventListener('pageshow', () => {
    delete root.dataset.kioskNavigationPending;
    delete root.dataset.kioskPageState;
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initKioskNavigation, {
      once: true,
    });
  } else {
    initKioskNavigation();
  }
}
