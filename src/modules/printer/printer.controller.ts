import { Router, Request, Response } from 'express';
import { PrinterService } from './printer.service';

export class PrinterController {
  public readonly router: Router;

  constructor(private readonly printerService: PrinterService) {
    this.router = Router();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    this.router.get('/status', this.getStatus);
  }

  private getStatus = async (_req: Request, res: Response): Promise<void> => {
    const response = this.printerService.getStatusResponse();
    res.set('Cache-Control', 'no-store');
    res.json(response);
  };
}
