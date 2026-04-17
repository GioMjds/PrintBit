import { Router, type Request, type Response } from 'express';
import {
  requireAdminLocalAccess,
  requireAdminPin,
} from '@/middleware/admin-auth';
import { ReceiptService } from './receipt.service';

export class ReceiptController {
  public readonly router: Router;

  constructor(private readonly receiptService: ReceiptService) {
    this.router = Router();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    this.router.get('/api/receipts/by-token/:token', this.getByToken);
    this.router.get(
      '/api/admin/transactions/:transactionId/receipt',
      requireAdminLocalAccess,
      requireAdminPin,
      this.getByTransactionIdForAdmin,
    );
  }

  private getByToken = (req: Request, res: Response): void => {
    const { token } = req.params as { token: string };
    const result = this.receiptService.resolveByToken(token);

    if (result.status === 'ok') {
      res.json(result.payload);
      return;
    }

    if (result.status === 'expired') {
      res.status(410).json({
        code: 'RECEIPT_TOKEN_EXPIRED',
        error: 'Receipt token has expired.',
      });
      return;
    }

    if (result.status === 'revoked') {
      res.status(403).json({
        code: 'RECEIPT_TOKEN_REVOKED',
        error: 'Receipt token has been revoked.',
      });
      return;
    }

    res.status(404).json({
      code: 'RECEIPT_TOKEN_NOT_FOUND',
      error: 'Receipt token is invalid.',
    });
  };

  private getByTransactionIdForAdmin = (req: Request, res: Response): void => {
    const transactionId = String(req.params.transactionId ?? '').trim();
    if (!transactionId) {
      res.status(400).json({ error: 'transactionId is required.' });
      return;
    }

    const result = this.receiptService.resolveByTransactionId(transactionId);
    if (result.status === 'not_found') {
      res.status(404).json({ error: 'Receipt not found.' });
      return;
    }

    if (result.status === 'expired') {
      res.status(410).json({ error: 'Receipt has expired.' });
      return;
    }

    if (result.status === 'ok') {
      res.json(result.payload);
      return;
    }

    res.status(500).json({ error: 'Unexpected receipt lookup state.' });
  };
}
