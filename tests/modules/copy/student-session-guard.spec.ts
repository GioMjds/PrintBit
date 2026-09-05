import fs from 'node:fs';
import type { Request, Response } from 'express';
import type { Server } from 'socket.io';
import { CopyController } from '@/modules/copy/copy.controller';
import { CopyService } from '@/modules/copy/copy.service';
import { db } from '@/services/db';
import { jobStore } from '@/services/job-store';
import * as documentAnalysis from '@/services/document-analysis';
import * as printQuote from '@/services/print-quote';
import * as timeSource from '@/services/time-source';
import * as services from '@/services';
import { attributeStudentTransaction } from '@/middleware/student-session';

jest.mock('@/middleware/student-session', () => ({
  attributeStudentTransaction: jest.fn(),
}));
jest.mock('@/services/db', () => ({
  db: { data: { balance: 50 } },
  acquireIdempotencyKey: jest.fn(),
  storeIdempotencyKey: jest.fn(),
  releaseIdempotencyKey: jest.fn(),
}));
jest.mock('@/services', () => ({
  evaluateInkPreflight: jest.fn(),
  persistAndEmitPrintLifecycleState: jest.fn(),
  refreshPrinterTelemetry: jest.fn(),
  settlementService: { settle: jest.fn() },
  watchJobForMalfunction: jest.fn(),
}));

const attribute = attributeStudentTransaction as jest.MockedFunction<
  typeof attributeStudentTransaction
>;

function response(): Response & { status: jest.Mock; json: jest.Mock } {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res as unknown as Response & { status: jest.Mock; json: jest.Mock };
}

describe('CopyService student transaction boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('attributes the final copy job once before lifecycle or balance work', async () => {
    const activeSessionRequired = Object.assign(
      new Error('ACTIVE_SESSION_REQUIRED'),
      { code: 'ACTIVE_SESSION_REQUIRED' },
    );
    attribute.mockImplementation(() => {
      throw activeSessionRequired;
    });
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(documentAnalysis, 'analyzeDocument').mockResolvedValue({} as never);
    jest.spyOn(printQuote, 'buildPrintQuote').mockReturnValue({
      ok: true,
      quote: {
        copies: 1,
        effectiveColorMode: 'grayscale',
        selectedPages: 1,
        billableColorPages: 0,
        billableBwPages: 1,
        requiredAmount: 5,
      },
    } as never);
    jest.spyOn(timeSource, 'assertTrustedTimeForFinancialOperation').mockReturnValue(undefined);
    jest.spyOn(jobStore, 'createCopyJob').mockReturnValue({ id: 'copy-final-id' } as never);
    const lifecycle = services.persistAndEmitPrintLifecycleState as jest.Mock;
    lifecycle.mockResolvedValue(undefined);
    (services.refreshPrinterTelemetry as jest.Mock).mockResolvedValue({
      connected: false,
      status: 'offline',
    });
    const startingBalance = db.data?.balance ?? 0;
    const studentSessionService = {};
    const copyService = new CopyService({
      io: {} as Server,
      resolvePublicBaseUrl: () => new URL('http://127.0.0.1:3000'),
      studentSessionService,
    } as never);

    await expect(
      copyService.createCopyJob(
        { previewPath: 'scan.pdf' },
        false,
        '',
        {} as Request,
      ),
    ).rejects.toBe(activeSessionRequired);

    expect(attribute).toHaveBeenCalledTimes(1);
    expect(attribute).toHaveBeenCalledWith(
      studentSessionService,
      'copy-final-id',
      'copy',
    );
    expect(lifecycle).not.toHaveBeenCalled();
    expect(db.data?.balance ?? 0).toBe(startingBalance);
    if (db.data) db.data.balance = startingBalance;
  });

  test('returns 403, releases idempotency, and removes the job when the session ends during preparation', async () => {
    const activeSessionRequired = Object.assign(
      new Error('ACTIVE_SESSION_REQUIRED'),
      { code: 'ACTIVE_SESSION_REQUIRED' },
    );
    attribute.mockImplementation(() => {
      throw activeSessionRequired;
    });
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(documentAnalysis, 'analyzeDocument').mockResolvedValue({} as never);
    jest.spyOn(printQuote, 'buildPrintQuote').mockReturnValue({
      ok: true,
      quote: {
        copies: 1,
        effectiveColorMode: 'grayscale',
        selectedPages: 1,
        billableColorPages: 0,
        billableBwPages: 1,
        requiredAmount: 5,
      },
    } as never);
    jest.spyOn(timeSource, 'assertTrustedTimeForFinancialOperation').mockReturnValue(undefined);
    const createJob = jest.spyOn(jobStore, 'createCopyJob');
    const copyService = new CopyService({
      io: {} as Server,
      resolvePublicBaseUrl: () => new URL('http://127.0.0.1:3000'),
      studentSessionService: {},
    } as never);
    jest.spyOn(copyService, 'claimIdempotencyKey').mockReturnValue({
      kind: 'claimed',
    });
    const release = jest.spyOn(copyService, 'releaseIdempotencyKey');
    const controller = new CopyController(copyService, {
      canAcceptCustomerWork: () => true,
    } as never);
    const res = response();
    let thrown: unknown;

    try {
      await (controller as any).createCopyJob(
        {
          get: jest.fn(() => 'copy-race-key'),
          body: { previewPath: 'scan.pdf' },
        } as unknown as Request,
        res,
      );
    } catch (error) {
      thrown = error;
    }

    const createdJob = createJob.mock.results[0]?.value;
    try {
      expect(thrown).toBeUndefined();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        code: 'STUDENT_IDENTIFICATION_REQUIRED',
      });
      expect(release).toHaveBeenCalledWith('copy-race-key');
      expect(createdJob).toBeDefined();
      expect(jobStore.getJob(createdJob.id)).toBeUndefined();
    } finally {
      if (createdJob) {
        (jobStore as unknown as { jobs: Map<string, unknown> }).jobs.delete(
          createdJob.id,
        );
      }
    }
  });
});
