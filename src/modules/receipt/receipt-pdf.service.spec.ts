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
    coinsInserted: 20.0,
    documentName: 'document-preview.pdf',
    printConfiguration: {
      copies: 1,
      colorMode: 'colored',
      paperSize: 'A4',
      quality: 'standard',
      duplex: false,
      orientation: 'portrait',
      pageRange: '1-3',
    },
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
      coinsInserted: null,
      documentName: null,
      printConfiguration: {
        copies: null,
        colorMode: null,
        paperSize: null,
        quality: null,
        duplex: null,
        orientation: null,
        pageRange: null,
      },
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

  it('includes document name, print configuration, coins inserted, and Missing Change in PDF stream', async () => {
    const payloadWithMissingChange: ReceiptPayload = {
      ...samplePayload,
      change: {
        requested: 10.0,
        dispensed: 4.0,
        remaining: 6.0,
        state: 'failed',
        attempts: 1,
        owedChangeId: 'OWE-5678',
        message: null,
      },
    };

    const pdfBuffer = await service.generateThermalReceiptPdf(payloadWithMissingChange);

    // Inflate all compressed streams in the PDF to verify rendered text content
    const pdfRaw = pdfBuffer.toString('latin1');
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let extractedText = '';
    let match: RegExpExecArray | null;
    while ((match = streamRegex.exec(pdfRaw)) !== null) {
      try {
        const decompressed = require('node:zlib')
          .inflateSync(Buffer.from(match[1], 'latin1'))
          .toString('latin1');
        extractedText += decompressed + '\n';
      } catch {
        extractedText += match[1] + '\n';
      }
    }

    const decodedText = extractedText.replace(/<([0-9a-fA-F]+)>/g, (_, hex) =>
      Buffer.from(hex, 'hex').toString('latin1'),
    );

    // Extract text from PDFKit's kerning TJ arrays: [ (string1) num (string2) ... ] TJ
    const unkernedText = decodedText.replace(/\[([\s\S]*?)\]\s*TJ/g, (_, inner) => {
      return inner.replace(/-?\d+(\.\d+)?/g, '').replace(/\s+/g, '');
    });

    expect(unkernedText).toContain('Document:');
    expect(unkernedText).toContain('document-preview.pdf');
    expect(unkernedText).toContain('Copies:');
    expect(unkernedText).toContain('ColorMode:');
    expect(unkernedText).toContain('PaperSize:');
    expect(unkernedText).toContain('PrintQuality:');
    expect(unkernedText).toContain('Duplex:');
    expect(unkernedText).toContain('Orientation:');
    expect(unkernedText).toContain('PageRange:');
    expect(unkernedText).toContain('CoinsInserted:');
    expect(unkernedText).toContain('MissingChange:');
    expect(unkernedText).not.toContain('RemainingOwed:');
  });
});

