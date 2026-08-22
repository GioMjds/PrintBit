import fs from 'node:fs';
import path from 'node:path';
import {
  resolveSameOriginNavigation,
  shouldAnimateStatusIdentity,
} from '@/public/shared/kiosk-motion';
import { kioskNavigationDelay } from '@/public/shared/kiosk-navigation';

const PUBLIC_DIR = path.resolve('src/public');
const MOTION_SCRIPT = '<script defer src="/shared/motion.js"></script>';

const CUSTOMER_PAGE_HTML = [
  'index.html',
  'config/index.html',
  'confirm/index.html',
  'copy/index.html',
  'feedback/index.html',
  'loading/index.html',
  'print/index.html',
  'receipt/index.html',
  'report/index.html',
  'scan/index.html',
  'upload/index.html',
];

const CUSTOMER_NAVIGATION_SOURCES = [
  'app.ts',
  'confirm/app.ts',
  'config/app.ts',
  'copy/app.ts',
  'loading/app.ts',
  'print/app.ts',
  'scan/app.ts',
];

function readPublicFile(relativePath: string): string {
  return fs.readFileSync(path.join(PUBLIC_DIR, relativePath), 'utf8');
}

describe('shared kiosk motion', () => {
  it.each(CUSTOMER_PAGE_HTML)(
    'loads the local motion runtime on %s',
    (relativePath) => {
      expect(readPublicFile(relativePath)).toContain(MOTION_SCRIPT);
    },
  );

  it('does not load customer motion on admin surfaces', () => {
    const adminHtml = fs
      .readdirSync(path.join(PUBLIC_DIR, 'admin'), {
        recursive: true,
        withFileTypes: true,
      })
      .filter((entry) => entry.isFile() && entry.name === 'index.html')
      .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8'));

    expect(adminHtml.length).toBeGreaterThan(0);
    expect(adminHtml.every((html) => !html.includes(MOTION_SCRIPT))).toBe(true);
    expect(readPublicFile('scc/index.html')).not.toContain(MOTION_SCRIPT);
  });

  it('transitions only same-origin page navigation', () => {
    const currentUrl = 'http://127.0.0.1:3000/config?mode=print';

    expect(resolveSameOriginNavigation('/confirm', currentUrl)).toBe(
      'http://127.0.0.1:3000/confirm',
    );
    expect(resolveSameOriginNavigation('#paper-size', currentUrl)).toBeNull();
    expect(resolveSameOriginNavigation('https://example.com/help', currentUrl)).toBeNull();
    expect(resolveSameOriginNavigation('mailto:help@example.com', currentUrl)).toBeNull();
  });

  it.each(CUSTOMER_NAVIGATION_SOURCES)(
    'routes scripted navigation through local motion on %s',
    (relativePath) => {
      expect(readPublicFile(relativePath)).toMatch(
        /import\s*{\s*navigateWithKioskMotion\s*}/,
      );
    },
  );

  it('keeps the reduced-motion navigation delay brief', () => {
    expect(kioskNavigationDelay(false)).toBe(170);
    expect(kioskNavigationDelay(true)).toBe(90);
  });

  it('keeps clocks and countdowns calm while animating meaningful statuses', () => {
    expect(
      shouldAnimateStatusIdentity({
        id: 'clockBlock',
        className: 'clock-block',
        ariaLabel: 'Current time and date',
      }),
    ).toBe(false);
    expect(
      shouldAnimateStatusIdentity({
        id: 'feedbackTimerCount',
        className: 'feedback-modal__timer',
        ariaLabel: '',
      }),
    ).toBe(false);
    expect(
      shouldAnimateStatusIdentity({
        id: 'statusMessage',
        className: 'status-badge__text',
        ariaLabel: 'Payment status',
      }),
    ).toBe(true);
  });

  it('defines reduced-motion handling in the shared stylesheet', () => {
    const globals = readPublicFile('globals.css');

    expect(globals).toContain('@media (prefers-reduced-motion: reduce)');
    expect(globals).toContain('html[data-kiosk-motion]');
    expect(globals).toContain('kiosk-page-depart-fade');
  });
});
