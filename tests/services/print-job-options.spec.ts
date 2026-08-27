import type { PrintJobOptions } from '@/services/printer';
import { withPrintQuality } from '@/services/print-job-options';

type PrintJobOptionsWithQuality = Omit<PrintJobOptions, 'quality'>;

describe('print job options', () => {
  it('preserves a selected High quality for downstream print dispatch', () => {
    const options = withPrintQuality(
      {
        copies: 1,
        colorMode: 'colored',
        orientation: 'portrait',
        paperSize: 'A4',
      },
      'high',
    );

    expect(options.quality).toBe('high');
  });
});
