import { translateHardwarePrinterError } from '../../src/services/printer-error-translation';

describe('translateHardwarePrinterError', () => {
  test('classifies an Epson/WMI no-paper status code without a descriptive message', () => {
    expect(
      translateHardwarePrinterError({
        message: 'Printer status monitor reported a device error.',
        errorCode: '4',
      }),
    ).toMatchObject({
      code: 'PAPER_TRAY_EMPTY',
      severity: 'recoverable',
      canRetry: true,
    });
  });

  test.each([
    ['6', 'PRINTER_OUT_OF_TONER'],
    ['9', 'PRINTER_OFFLINE'],
    ['11', 'OUTPUT_BIN_FULL'],
  ])('uses the Win32_Printer DetectedErrorState mapping for code %s', (errorCode, code) => {
    expect(translateHardwarePrinterError({ errorCode })).toMatchObject({ code });
  });
});
