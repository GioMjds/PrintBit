import { isMobileViewport } from '../../src/public/shared/device-mode';

test('treats narrow viewports as mobile so kiosk-only idle screens can be skipped', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  (globalThis as { window?: unknown }).window = {
    matchMedia: (query: string) => ({
      matches: query === '(max-width: 780px)',
    }),
  };

  expect(isMobileViewport()).toBe(true);

  (globalThis as { window?: unknown }).window = originalWindow;
});

test('treats kiosk-sized viewports as non-mobile', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  (globalThis as { window?: unknown }).window = {
    matchMedia: () => ({ matches: false }),
  };

  expect(isMobileViewport()).toBe(false);

  (globalThis as { window?: unknown }).window = originalWindow;
});
