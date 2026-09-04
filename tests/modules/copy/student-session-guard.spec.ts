import fs from 'node:fs';
import type { Request } from 'express';
import type { Server } from 'socket.io';
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

describe('CopyService student transaction boundary', () => {
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
});
