import { Router, Request, Response } from 'express';
import type {
  CreateCopyJobInput,
  CopyService,
  IdempotencyKeyInflightResult,
} from './copy.service';
import {
  powerSafetyService,
  type PowerSafetyService,
} from '@/services/power-safety';

export class CopyController {
  public readonly router: Router;
  constructor(
    private readonly copyService: CopyService,
    private readonly powerSafety: PowerSafetyService = powerSafetyService,
  ) {
    this.router = Router();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    this.router.post('/jobs', this.createCopyJob);
    this.router.get('/jobs/:id', this.getCopyJob);
    this.router.post('/jobs/:id/cancel', this.cancelCopyJob);
    this.router.post('/quote', this.getCopyQuote);
  }

  private getCopyQuote = async (req: Request, res: Response): Promise<void> => {
    const result = await this.copyService.getCopyQuote(req.body);
    res.status(result.statusCode).json(result.body);
  };

  private createCopyJob = async (req: Request, res: Response): Promise<void> => {
    if (!this.powerSafety.canAcceptCustomerWork()) {
      res.status(503).json({
        code: 'POWER_EMERGENCY',
        message: 'Power emergency active; customer work suspended',
      });
      return;
    }

    const idempotencyKey = req.get('Idempotency-Key') ?? '';
    const claim = this.copyService.claimIdempotencyKey(idempotencyKey);

    if (claim.kind === 'hit') {
      res.status(claim.statusCode).json(claim.body);
      return;
    }
    if (claim.kind === 'inflight') {
      await this.handleInflightIdempotency(claim, res);
      return;
    }

    let result: Awaited<ReturnType<CopyService['createCopyJob']>>;
    try {
      result = await this.copyService.createCopyJob(
        req.body as CreateCopyJobInput,
        true,
        idempotencyKey,
        req,
      );
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ACTIVE_SESSION_REQUIRED'
      ) {
        this.copyService.releaseIdempotencyKey(idempotencyKey);
        res.status(403).json({ code: 'STUDENT_IDENTIFICATION_REQUIRED' });
        return;
      }
      throw error;
    }

    if (result.cacheIdempotencyResponse) {
      this.copyService.storeIdempotencyResponse(
        idempotencyKey,
        result.statusCode,
        result.body,
      );
    }
    res.status(result.statusCode).json(result.body);
  };

  private getCopyJob = (req: Request, res: Response): void => {
    const result = this.copyService.getCopyJob(req.params.id as string);
    res.status(result.statusCode).json(result.body);
  };

  private cancelCopyJob = (req: Request, res: Response): void => {
    const result = this.copyService.cancelCopyJob(req.params.id as string);
    res.status(result.statusCode).json(result.body);
  };

  private async handleInflightIdempotency(
    claim: IdempotencyKeyInflightResult,
    res: Response,
  ): Promise<void> {
    const entry = await claim.promise;
    if (entry) {
      res.status(entry.statusCode).json(entry.response);
      return;
    }
    res.status(503).json({ error: 'Concurrent request failed. Please retry.' });
  }
}
