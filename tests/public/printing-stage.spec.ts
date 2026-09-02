import { getPrintingStage } from '../../src/public/confirm/printing-stage';

describe('printing stage', () => {
  test('shows a useful stage before page telemetry arrives', () => {
    expect(getPrintingStage({ pagesPrinted: 0, totalPages: null })).toEqual({
      label: 'Preparing your print job…',
      progress: null,
    });
  });

  test('shows the current printed page when telemetry arrives', () => {
    expect(getPrintingStage({ pagesPrinted: 2, totalPages: 5 })).toEqual({
      label: 'Printing page 2 of 5',
      progress: 40,
    });
  });
});
