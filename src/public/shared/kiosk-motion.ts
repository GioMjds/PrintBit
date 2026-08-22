import {
  navigateWithKioskMotion,
  resolveSameOriginNavigation,
} from './kiosk-navigation';

export { navigateWithKioskMotion, resolveSameOriginNavigation };

export interface StatusIdentity {
  id: string;
  className: string;
  ariaLabel: string;
}

const FAST_CHANGING_STATUS_PATTERN =
  /(^|[\s_-])(clock|timer|countdown)([\s_-]|$)|current time|time and date/i;
const FAST_CHANGING_CONTENT_PATTERN =
  /\b\d{1,2}:\d{2}\b|\b(expires|retry|redirecting) in \d+/i;

export function shouldAnimateStatusIdentity(identity: StatusIdentity): boolean {
  return !FAST_CHANGING_STATUS_PATTERN.test(
    `${identity.id} ${identity.className} ${identity.ariaLabel}`,
  );
}

const STATUS_SELECTOR = [
  '[role="status"]',
  '[aria-live="polite"]',
  '[aria-live="assertive"]',
  '[data-status]',
  '[data-state]',
  '.preview-status',
  '.footer-hint',
  '.session-pill',
  '.delivery-status',
  '.message-banner',
  '.receipt-message',
  '.rp-msg',
].join(',');

const STATE_SURFACE_SELECTOR = [
  '.state-screen',
  '.fb-shell',
  '.rp-state',
  '.rp-card',
  '.preview-state',
  '.receipt-body',
].join(',');

const STATUS_SURFACE_EXCLUSION_SELECTOR = [
  '.guide-overlay',
  '.report-overlay',
  '.feedback-overlay',
  '.wifi-overlay',
  '.admin-overlay',
  '.onboarding-overlay',
  '.modal-overlay',
  '.modal',
  '.scan-overlay',
].join(',');

const MOTION_CLASS_NAMES = new Set([
  'kiosk-status-change',
  'kiosk-state-enter',
]);

function identityFor(element: HTMLElement): StatusIdentity {
  return {
    id: element.id,
    className: element.className,
    ariaLabel: element.getAttribute('aria-label') ?? '',
  };
}

function isVisible(element: HTMLElement): boolean {
  return (
    !element.hidden &&
    !element.classList.contains('hidden') &&
    element.getAttribute('aria-hidden') !== 'true' &&
    window.getComputedStyle(element).display !== 'none'
  );
}

function isMotionOnlyClassMutation(record: MutationRecord): boolean {
  if (record.type !== 'attributes' || record.attributeName !== 'class') {
    return false;
  }

  const previous = new Set(
    (record.oldValue ?? '').split(/\s+/).filter(Boolean),
  );
  const current = new Set(
    (record.target as HTMLElement).className.split(/\s+/).filter(Boolean),
  );
  MOTION_CLASS_NAMES.forEach((className) => {
    previous.delete(className);
    current.delete(className);
  });

  return (
    previous.size === current.size &&
    [...previous].every((className) => current.has(className))
  );
}

function replayMotionClass(element: HTMLElement, className: string): void {
  element.classList.remove(className);
  window.requestAnimationFrame(() => {
    if (!isVisible(element)) return;
    element.classList.add(className);
    element.addEventListener(
      'animationend',
      () => element.classList.remove(className),
      { once: true },
    );
  });
}

function statusElementFor(node: Node): HTMLElement | null {
  const element = node instanceof HTMLElement ? node : node.parentElement;
  if (!element) return null;
  if (element.matches(STATUS_SELECTOR)) return element;
  return element.closest<HTMLElement>(STATUS_SELECTOR);
}

function shouldAnimateStatusElement(element: HTMLElement): boolean {
  return (
    !element.matches(STATUS_SURFACE_EXCLUSION_SELECTOR) &&
    shouldAnimateStatusIdentity(identityFor(element)) &&
    !FAST_CHANGING_CONTENT_PATTERN.test(element.textContent ?? '') &&
    isVisible(element)
  );
}

function becameVisible(
  record: MutationRecord,
  element: HTMLElement,
): boolean {
  if (record.type !== 'attributes' || !isVisible(element)) return false;

  if (record.attributeName === 'hidden') {
    return !element.hasAttribute('hidden');
  }
  if (record.attributeName === 'aria-hidden') {
    return record.oldValue === 'true';
  }
  if (record.attributeName === 'class') {
    const previousClasses = (record.oldValue ?? '').split(/\s+/);
    return (
      previousClasses.includes('hidden') &&
      !element.classList.contains('hidden')
    );
  }
  if (record.attributeName === 'style') {
    return /display\s*:\s*none/i.test(record.oldValue ?? '');
  }

  return false;
}

function observeInterfaceChanges(): MutationObserver {
  const observer = new MutationObserver((records) => {
    const statuses = new Set<HTMLElement>();

    records.forEach((record) => {
      if (isMotionOnlyClassMutation(record)) return;

      const target =
        record.target instanceof HTMLElement
          ? record.target
          : record.target.parentElement;
      if (!target) return;

      if (
        target.matches(STATE_SURFACE_SELECTOR) &&
        becameVisible(record, target)
      ) {
        replayMotionClass(target, 'kiosk-state-enter');
      }

      const status = statusElementFor(record.target);
      if (status && shouldAnimateStatusElement(status)) statuses.add(status);
    });

    statuses.forEach((status) =>
      replayMotionClass(status, 'kiosk-status-change'),
    );
  });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: [
      'aria-busy',
      'aria-hidden',
      'class',
      'data-state',
      'data-status',
      'hidden',
      'style',
    ],
  });

  return observer;
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

export function initKioskMotion(): void {
  const root = document.documentElement;
  if (root.dataset.kioskMotionInitialized === 'true') return;

  root.dataset.kioskMotionInitialized = 'true';
  root.dataset.kioskMotion = 'ready';
  root.dataset.kioskPageState = 'entering';
  window.requestAnimationFrame(() => {
    root.dataset.kioskPageState = 'entered';
  });

  document.addEventListener('click', handlePageNavigation);
  observeInterfaceChanges();
  window.addEventListener('pageshow', () => {
    delete root.dataset.kioskNavigationPending;
    root.dataset.kioskPageState = 'entered';
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initKioskMotion, {
      once: true,
    });
  } else {
    initKioskMotion();
  }
}
