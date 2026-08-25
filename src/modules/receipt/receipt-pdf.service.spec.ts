import { ReceiptPdfService } from './receipt-pdf.service';
import type { ReceiptPayload } from './receipt.service';

describe('ReceiptPdfService', () => {
  let service: ReceiptPdfService;

  beforeEach(() => {
    service = new ReceiptPdfService();
  });

  const samplePayload: ReceiptPayload = {
    transactionId: 'PB-20260825-001',
    mode: 'print',
    chargedAmount: 15.0,
    colorPages: 2,
    bwPages: 1,
    pagesPrinted: 3,
    totalPages: 3,
    status: 'printed',
    change: {
      requested: 5.0,
      dispensed: 5.0,
      remaining: 0,
      state: 'dispensed',
      attempts: 1,
      owedChangeId: null,
      message: null,
    },
    settledAt: '2026-08-25T14:30:00.000Z',
    terminalAt: '2026-08-25T14:31:00.000Z',
    generatedAt: '2026-08-25T14:31:05.000Z',
  };

  it('generates a valid PDF buffer starting with %PDF-', async () => {
    const pdfBuffer = await service.generateThermalReceiptPdf(samplePayload);

    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.length).toBeGreaterThan(100);

    // Standard PDF header signature
    const header = pdfBuffer.subarray(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');
  });

  it('handles copy mode and outstanding owed change in PDF generation', async () => {
    const copyPayload: ReceiptPayload = {
      ...samplePayload,
      mode: 'copy',
      colorPages: null,
      bwPages: null,
      pagesPrinted: 5,
      totalPages: 5,
      change: {
        requested: 10.0,
        dispensed: 4.0,
        remaining: 6.0,
        state: 'failed',
        attempts: 2,
        owedChangeId: 'OWE-1234',
        message: 'Hopper low on 1-peso coins',
      },
    };

    const pdfBuffer = await service.generateThermalReceiptPdf(copyPayload);
    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.length).toBeGreaterThan(100);
    expect(pdfBuffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('handles zero change and minimal payload gracefully', async () => {
    const minimalPayload: ReceiptPayload = {
      transactionId: 'PB-MINIMAL-01',
      mode: 'print',
      chargedAmount: 5.0,
      colorPages: 0,
      bwPages: 1,
      pagesPrinted: 1,
      totalPages: 1,
      status: 'printed',
      change: {
        requested: 0,
        dispensed: 0,
        remaining: 0,
        state: 'none',
        attempts: 0,
        owedChangeId: null,
        message: null,
      },
      settledAt: null,
      terminalAt: null,
      generatedAt: '2026-08-25T14:40:00.000Z',
    };

    const pdfBuffer = await service.generateThermalReceiptPdf(minimalPayload);
    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.length).toBeGreaterThan(100);
    expect(pdfBuffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});
