import fs from 'node:fs';
import { ScannerService } from '@/modules/scanner/scanner.service';
import { adminService } from '@/services/admin';
import { financialLedgerService } from '@/services/financial-ledger';
import { settlementService } from '@/services';
import * as timeSource from '@/services/time-source';
import { attributeStudentTransaction } from '@/middleware/student-session';

jest.mock('@/middleware/student-session', () => ({
  attributeStudentTransaction: jest.fn(),
}));
jest.mock('@/services', () => ({
  settlementService: { settle: jest.fn() },
}));

const attribute = attributeStudentTransaction as jest.MockedFunction<
  typeof attributeStudentTransaction
>;

function successfulSettlement() {
  return {
    ok: true,
    chargedAmount: 5,
    remainingBalance: 0,
    change: {
      state: 'none',
      requested: 0,
      dispensed: 0,
      attempts: 0,
    },
  } as never;
}

describe('ScannerService student transaction boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(adminService, 'getPricingSettings').mockReturnValue({
      scanDocument: 5,
    } as never);
    jest.spyOn(adminService, 'appendAdminLog').mockResolvedValue(undefined as never);
    jest.spyOn(timeSource, 'assertTrustedTimeForFinancialOperation').mockReturnValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('stops before ledger and settlement when scan attribution has no active session', async () => {
    const activeSessionRequired = Object.assign(
      new Error('ACTIVE_SESSION_REQUIRED'),
      { code: 'ACTIVE_SESSION_REQUIRED' },
    );
    attribute.mockImplementation(() => {
      throw activeSessionRequired;
    });
    const ledger = jest.spyOn(financialLedgerService, 'append').mockResolvedValue({} as never);
    const settle = jest.spyOn(settlementService, 'settle').mockResolvedValue(
      successfulSettlement(),
    );
    const service = new (ScannerService as any)({ studentSessionService: {} }) as ScannerService;

    await expect(
      service.chargeSoftCopy({
        filename: 'scan.pdf',
        io: {} as never,
        publicBaseUrl: 'http://127.0.0.1:3000',
      }),
    ).rejects.toBe(activeSessionRequired);

    expect(attribute).toHaveBeenCalledTimes(1);
    expect(ledger).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });

  test('returns the same paid scan ID that is attributed exactly once', async () => {
    attribute.mockReturnValue(undefined);
    jest.spyOn(financialLedgerService, 'append').mockResolvedValue({} as never);
    jest.spyOn(settlementService, 'settle').mockResolvedValue(
      successfulSettlement(),
    );
    const studentSessionService = {};
    const service = new (ScannerService as any)({ studentSessionService }) as ScannerService;
    jest.spyOn(service, 'createWirelessLink').mockResolvedValue({} as never);
    jest.spyOn((service as any).receiptService, 'upsertReceiptSnapshot').mockReturnValue(undefined);
    jest.spyOn((service as any).receiptService, 'mintToken').mockReturnValue(null);

    const result = await service.chargeSoftCopy({
      filename: 'scan.pdf',
      io: {} as never,
      publicBaseUrl: 'http://127.0.0.1:3000',
    });

    expect(result.charged).toBe(true);
    expect(attribute).toHaveBeenCalledTimes(1);
    expect(attribute).toHaveBeenCalledWith(
      studentSessionService,
      result.transactionId,
      'scan',
    );
  });
});
