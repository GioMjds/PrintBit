import { buildPhysicalPrintSettings } from '../../src/public/confirm/print-settings';

test('preserves every customer print selection for print and copy requests', () => {
  expect(
    buildPhysicalPrintSettings(
      {
        copies: 4,
        quality: 'high',
        orientation: 'landscape',
        rotationDeg: 180,
        paperSize: 'Legal',
        pageRange: { type: 'custom', range: '2-5' },
      },
      'grayscale',
    ),
  ).toEqual({
    copies: 4,
    colorMode: 'grayscale',
    quality: 'high',
    orientation: 'landscape',
    rotationDeg: 180,
    paperSize: 'Legal',
    pageRange: { type: 'custom', range: '2-5' },
  });
});

test('fills in safe defaults when optional physical settings are omitted', () => {
  expect(
    buildPhysicalPrintSettings(
      {
        copies: 1,
        orientation: 'portrait',
        paperSize: 'A4',
      },
      'colored',
    ),
  ).toEqual({
    copies: 1,
    colorMode: 'colored',
    quality: 'standard',
    orientation: 'portrait',
    rotationDeg: 0,
    paperSize: 'A4',
    pageRange: { type: 'all' },
  });
});

test('preserves single-page print selection', () => {
  expect(
    buildPhysicalPrintSettings(
      {
        copies: 2,
        quality: 'standard',
        orientation: 'portrait',
        rotationDeg: 90,
        paperSize: 'Letter',
        pageRange: { type: 'single', page: 3 },
      },
      'colored',
    ),
  ).toEqual({
    copies: 2,
    colorMode: 'colored',
    quality: 'standard',
    orientation: 'portrait',
    rotationDeg: 90,
    paperSize: 'Letter',
    pageRange: { type: 'single', page: 3 },
  });
});
