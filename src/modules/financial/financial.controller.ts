import { Router, Request, Response } from 'express';
import {
  legacyUploadMiddleware,
  validateLegacyUploadMagicBytes,
  handleMulterError,
} from '@/middleware/file-validation';
import { FinancialService } from './financial.service';

export class FinancialController {
  public readonly router: Router;

  constructor(private readonly financialService: FinancialService) {
    this.router = Router();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    this.router.get('/coin', this.addCoinCompatibility);
    this.router.get('/api/balance', this.getBalance);
    this.router.get('/api/pricing', this.getPricing);
    this.router.get(
      '/api/transactions/:transactionId/receipt',
      this.getTransactionReceipt,
    );
    this.router.post('/api/print/quote', this.getPrintQuote);
    this.router.post('/api/balance/reset', this.resetBalance);
    this.router.post('/api/balance/add-test-coin', this.addTestCoin);
    this.router.post(
      '/upload',
      legacyUploadMiddleware.single('file'),
      validateLegacyUploadMagicBytes,
      this.uploadLegacy,
    );
    this.router.use('/upload', handleMulterError);
    this.router.post('/print', this.printLegacy);
    this.router.post('/api/confirm-payment', this.confirmPayment);
  }

  private getBalance = (req: Request, res: Response): void => {
    this.financialService.getBalance(req, res);
  };

  private addCoinCompatibility = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    await this.financialService.addCoinCompatibility(req, res);
  };

  private getPricing = (req: Request, res: Response): void => {
    this.financialService.getPricing(req, res);
  };

  private getTransactionReceipt = (req: Request, res: Response): void => {
    this.financialService.getTransactionReceipt(req, res);
  };

  private getPrintQuote = (req: Request, res: Response): void => {
    this.financialService.getPrintQuote(req, res);
  };

  private resetBalance = async (req: Request, res: Response): Promise<void> => {
    await this.financialService.resetBalance(req, res);
  };

  private addTestCoin = async (req: Request, res: Response): Promise<void> => {
    await this.financialService.addTestCoin(req, res);
  };

  private uploadLegacy = async (req: Request, res: Response): Promise<void> => {
    await this.financialService.uploadLegacy(req, res);
  };

  private printLegacy = async (req: Request, res: Response): Promise<void> => {
    await this.financialService.printLegacy(req, res);
  };

  private confirmPayment = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    await this.financialService.confirmPayment(req, res);
  };
}
