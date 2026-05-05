import { computeJobPricing } from '../src/services/pricing-engine';
import { db } from '../src/services/db';
import type { DocumentAnalysis } from '../src/services/session';

describe('Pricing Engine mixed-page billing', () => {
  it('does not force grayscale pages to full-color charges in colored mode', () => {
    const previousData = db.data;
    db.data = null;

    try {
      const analysis: DocumentAnalysis = {
        fileType: 'pdf',
        pageCount: 2,
        totalPages: 2,
        colorPages: 1,
        bwPages: 1,
        confidence: 'high',
        analyzedAt: new Date(),
        pages: [
          {
            index: 1,
            isColor: false,
            coverage: 0,
            classification: 'bw',
            isBlank: false,
          },
          {
            index: 2,
            isColor: true,
            coverage: 0.9,
            classification: 'full_color',
            isBlank: false,
          },
        ],
      };

      const breakdown = computeJobPricing({
        analysis,
        selectedPageIndices: new Set([1, 2]),
        copies: 1,
        colorMode: 'colored',
        paperSize: 'A4',
      });

      const bwPage = breakdown.pages.find((page) => page.index === 1);
      const colorPage = breakdown.pages.find((page) => page.index === 2);

      expect(bwPage?.classification).toBe('bw');
      expect(bwPage?.rawPriceExact).toBe(5);
      expect(colorPage?.classification).toBe('full_color');
      expect(colorPage?.rawPriceExact).toBe(15);
      expect(breakdown.finalPayablePeso).toBe(20);
    } finally {
      db.data = previousData;
    }
  });
});
