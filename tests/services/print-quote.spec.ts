import { buildPrintQuote } from '@/services/print-quote';
import { adminService } from '@/services/admin';
import type { DocumentAnalysis } from '@/services/session';

describe('Print Quote and Admin Pricing Calculations', () => {
  const sampleBwAnalysis: DocumentAnalysis = {
    fileType: 'pdf',
    pageCount: 1,
    totalPages: 1,
    colorPages: 0,
    bwPages: 1,
    confidence: 'high',
    analyzedAt: new Date(),
    pages: [
      {
        index: 1,
        isColor: false,
        coverage: 0.1,
        classification: 'bw',
        isBlank: false,
      },
    ],
  };

  const sampleColorAnalysis: DocumentAnalysis = {
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
        coverage: 0.1,
        classification: 'bw',
        isBlank: false,
      },
      {
        index: 2,
        isColor: true,
        coverage: 0.5,
        classification: 'full_color',
        isBlank: false,
      },
    ],
  };

  describe('buildPrintQuote', () => {
    it('calculates 1 copy of 1-page B&W document on A4 as ₱3', () => {
      const result = buildPrintQuote({
        analysis: sampleBwAnalysis,
        colorMode: 'grayscale',
        copies: 1,
        paperSize: 'A4',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.quote.requiredAmount).toBe(3);
        expect(result.quote.copies).toBe(1);
        expect(result.quote.selectedPages).toBe(1);
      }
    });

    it('calculates 10 copies of 1-page B&W document on A4 as ₱30 (exact 10x multiplier, no bulk discount)', () => {
      const result = buildPrintQuote({
        analysis: sampleBwAnalysis,
        colorMode: 'grayscale',
        copies: 10,
        paperSize: 'A4',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.quote.requiredAmount).toBe(30);
        expect(result.quote.copies).toBe(10);
        expect(result.quote.selectedPages).toBe(1);
      }
    });

    it('calculates 10 copies of 2-page mixed document on A4 in colored mode as ₱210', () => {
      const result = buildPrintQuote({
        analysis: sampleColorAnalysis,
        colorMode: 'colored',
        copies: 10,
        paperSize: 'A4',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // 1 Color page @ ₱18 + 1 B&W page @ ₱3 = ₱21 per copy * 10 copies = ₱210
        expect(result.quote.requiredAmount).toBe(210);
        expect(result.quote.copies).toBe(10);
        expect(result.quote.billableColorPages).toBe(1);
        expect(result.quote.billableBwPages).toBe(1);
      }
    });

    it('calculates 10 copies on Long Bond (Legal) paper size correctly', () => {
      const result = buildPrintQuote({
        analysis: sampleBwAnalysis,
        colorMode: 'grayscale',
        copies: 10,
        paperSize: 'Legal',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Long Bond base B&W is ₱4 * 10 copies = ₱40
        expect(result.quote.requiredAmount).toBe(40);
      }
    });
  });

  describe('adminService.calculateJobAmount', () => {
    it('calculates exact multiple of copies for B&W print job on A4', () => {
      const singleCopy = adminService.calculateJobAmount(
        'print',
        { colorPages: 0, bwPages: 1 },
        1,
        'A4',
      );
      const tenCopies = adminService.calculateJobAmount(
        'print',
        { colorPages: 0, bwPages: 1 },
        10,
        'A4',
      );

      expect(singleCopy).toBe(3);
      expect(tenCopies).toBe(30);
    });

    it('calculates exact multiple of copies for Short Bond (Letter)', () => {
      const tenCopies = adminService.calculateJobAmount(
        'print',
        { colorPages: 0, bwPages: 1 },
        10,
        'Letter',
      );

      expect(tenCopies).toBe(30);
    });

    it('calculates exact multiple of copies for Long Bond (Legal)', () => {
      const tenCopies = adminService.calculateJobAmount(
        'print',
        { colorPages: 0, bwPages: 1 },
        10,
        'Legal',
      );

      expect(tenCopies).toBe(40);
    });
  });
});
