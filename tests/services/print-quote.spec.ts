import type { DocumentAnalysis } from '@/services/session';

const calculateDocumentAmount = jest.fn(
  (_mode: string, pages: { colorPages: number; bwPages: number }) =>
    pages.colorPages * 18 + pages.bwPages * 3,
);

jest.mock('@/services/admin', () => ({
  adminService: {
    calculateDocumentAmount,
    getPricingSettings: () => ({
      printPerPage: 3,
      colorSurcharge: 15,
      highQualitySurcharge: 2,
    }),
  },
}));

import { buildPrintQuote } from '@/services/print-quote';

const grayscaleFourPageAnalysis: DocumentAnalysis = {
  fileType: 'pdf',
  pageCount: 4,
  pages: [1, 2, 3, 4].map((index) => ({ index, isColor: false })),
  colorPages: 0,
  bwPages: 4,
  totalPages: 4,
  confidence: 'high',
  analyzedAt: new Date(),
  analysisVersion: 1,
};

beforeEach(() => {
  calculateDocumentAmount.mockClear();
});

test('charges the configured color rate when the customer selects Colored', () => {
  const result = buildPrintQuote({
    analysis: grayscaleFourPageAnalysis,
    colorMode: 'colored',
    copies: 1,
    paperSize: 'A4',
  });

  expect(result).toEqual(
    expect.objectContaining({
      ok: true,
      quote: expect.objectContaining({
        billableColorPages: 4,
        billableBwPages: 0,
        effectiveColorMode: 'colored',
        requiredAmount: 72,
      }),
    }),
  );
});
