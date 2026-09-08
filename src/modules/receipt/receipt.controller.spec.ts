import type { Request, Response } from 'express';
import { ReceiptController } from './receipt.controller';
import type { ReceiptService, ReceiptPayload } from './receipt.service';
import type { ReceiptPdfService } from './receipt-pdf.service';

describe('ReceiptController PDF endpoints', () => {
  let controller: ReceiptController;
  let mockReceiptService: jest.Mocked<Partial<ReceiptService>>;
  let mockPdfService: jest.Mocked<Partial<ReceiptPdfService>>;

  const samplePayload: ReceiptPayload = {
    transactionId: 'PB-TX-999',
    mode: 'print',
    chargedAmount: 10.0,
    colorPages: 1,
    bwPages: 1,
    pagesPrinted: 2,
    totalPages: 2,
    coinsInserted: 10.0,
    documentName: 'document.pdf',
    printConfiguration: {
      copies: 1,
      colorMode: 'colored',
      paperSize: 'A4',
      quality: 'standard',
      duplex: false,
      orientation: 'portrait',
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
    settledAt: '2026-08-25T14:30:00.000Z',
    terminalAt: '2026-08-25T14:31:00.000Z',
    generatedAt: '2026-08-25T14:31:05.000Z',
  };

  const samplePdfBuffer = Buffer.from('%PDF-1.4 Mock Thermal Receipt PDF');

  beforeEach(() => {
    mockReceiptService = {
      resolveByToken: jest.fn(),
      resolveByTransactionId: jest.fn(),
    };
    mockPdfService = {
      generateThermalReceiptPdf: jest.fn().mockResolvedValue(samplePdfBuffer),
    };

    controller = new ReceiptController(
      mockReceiptService as ReceiptService,
      mockPdfService as ReceiptPdfService,
    );
  });

  function createMockResponse(): Partial<Response> & {
    _status: number;
    _headers: Record<string, string>;
    _sent: any;
  } {
    const res: any = {
      _status: 200,
      _headers: {},
      _sent: null,
      status(code: number) {
        this._status = code;
        return this;
      },
      setHeader(name: string, value: string) {
        this._headers[name.toLowerCase()] = value;
        return this;
      },
      send(data: any) {
        this._sent = data;
        return this;
      },
      json(data: any) {
        this._sent = data;
        return this;
      },
    };
    return res;
  }

  describe('GET /api/receipts/by-token/:token/pdf', () => {
    it('returns PDF with attachment disposition on valid token', async () => {
      (mockReceiptService.resolveByToken as jest.Mock).mockReturnValue({
        status: 'ok',
        receipt: { id: 'r-1', transactionId: 'PB-TX-999' } as any,
        accessToken: { id: 't-1' } as any,
        payload: samplePayload,
      });

      const req = { params: { token: 'valid-token' } } as unknown as Request;
      const res = createMockResponse();

      const getPdfByToken = (controller as any).getPdfByToken;
      await getPdfByToken(req, res);

      expect(mockPdfService.generateThermalReceiptPdf).toHaveBeenCalledWith(
        samplePayload,
      );
      expect(res._status).toBe(200);
      expect(res._headers['content-type']).toBe('application/pdf');
      expect(res._headers['content-disposition']).toContain(
        'attachment; filename="printbit-receipt-PB-TX-999.pdf"',
      );
      expect(res._sent).toEqual(samplePdfBuffer);
    });

    it('returns 410 when token is expired', async () => {
      (mockReceiptService.resolveByToken as jest.Mock).mockReturnValue({
        status: 'expired',
      });

      const req = { params: { token: 'expired-token' } } as unknown as Request;
      const res = createMockResponse();

      const getPdfByToken = (controller as any).getPdfByToken;
      await getPdfByToken(req, res);

      expect(res._status).toBe(410);
      expect(res._sent).toEqual({
        code: 'RECEIPT_TOKEN_EXPIRED',
        error: 'Receipt token has expired.',
      });
    });

    it('returns 403 when token is revoked', async () => {
      (mockReceiptService.resolveByToken as jest.Mock).mockReturnValue({
        status: 'revoked',
      });

      const req = { params: { token: 'revoked-token' } } as unknown as Request;
      const res = createMockResponse();

      const getPdfByToken = (controller as any).getPdfByToken;
      await getPdfByToken(req, res);

      expect(res._status).toBe(403);
      expect(res._sent).toEqual({
        code: 'RECEIPT_TOKEN_REVOKED',
        error: 'Receipt token has been revoked.',
      });
    });

    it('returns 404 when token is unknown', async () => {
      (mockReceiptService.resolveByToken as jest.Mock).mockReturnValue({
        status: 'unknown',
      });

      const req = { params: { token: 'bad-token' } } as unknown as Request;
      const res = createMockResponse();

      const getPdfByToken = (controller as any).getPdfByToken;
      await getPdfByToken(req, res);

      expect(res._status).toBe(404);
      expect(res._sent).toEqual({
        code: 'RECEIPT_TOKEN_NOT_FOUND',
        error: 'Receipt token is invalid.',
      });
    });
  });

  describe('GET /api/admin/transactions/:transactionId/receipt/pdf', () => {
    it('returns PDF for valid transactionId', async () => {
      (mockReceiptService.resolveByTransactionId as jest.Mock).mockReturnValue({
        status: 'ok',
        receipt: { id: 'r-1', transactionId: 'PB-TX-999' } as any,
        payload: samplePayload,
      });

      const req = {
        params: { transactionId: 'PB-TX-999' },
      } as unknown as Request;
      const res = createMockResponse();

      const getPdfByTx = (controller as any).getPdfByTransactionIdForAdmin;
      await getPdfByTx(req, res);

      expect(res._status).toBe(200);
      expect(res._headers['content-type']).toBe('application/pdf');
      expect(res._headers['content-disposition']).toContain(
        'attachment; filename="printbit-receipt-PB-TX-999.pdf"',
      );
      expect(res._sent).toEqual(samplePdfBuffer);
    });

    it('returns 404 when transaction is not found', async () => {
      (mockReceiptService.resolveByTransactionId as jest.Mock).mockReturnValue({
        status: 'not_found',
      });

      const req = {
        params: { transactionId: 'UNKNOWN' },
      } as unknown as Request;
      const res = createMockResponse();

      const getPdfByTx = (controller as any).getPdfByTransactionIdForAdmin;
      await getPdfByTx(req, res);

      expect(res._status).toBe(404);
      expect(res._sent).toEqual({ error: 'Receipt not found.' });
    });
  });
});
