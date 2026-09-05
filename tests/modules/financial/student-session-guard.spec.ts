import type { Request, Response } from 'express';
import type { Server } from 'socket.io';
import { FinancialService } from '@/modules/financial/financial.service';
import { db } from '@/services/db';
import { settlementService } from '@/services/settlement';
import { attributeStudentTransaction } from '@/middleware/student-session';

jest.mock('@/middleware/student-session', () => ({
  attributeStudentTransaction: jest.fn(),
}));
jest.mock('@/services', () => ({
  evaluateInkPreflight: jest.fn(),
  getPrinterTelemetry: jest.fn(),
  refreshPrinterTelemetry: jest.fn(),
  isCoinSlotLocked: jest.fn(),
  isCoinSlotLockedBy: jest.fn(),
  getCoinSlotLockOwnerId: jest.fn(),
}));
jest.mock('@/services/power-safety', () => ({
  powerSafetyService: { canAcceptCustomerWork: () => true },
}));
jest.mock('@/services/recovery', () => ({
  ...jest.requireActual('@/services/recovery'),
  checkpointRecoverySession: jest.fn().mockResolvedValue(undefined),
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

function service(studentSessionService: object): FinancialService {
  return new FinancialService({
    io: {} as Server,
    sessionStore: {} as never,
    resolvePublicBaseUrl: () => new URL('http://127.0.0.1:3000'),
    powerSafetyService: { canAcceptCustomerWork: () => true } as never,
    studentSessionService,
  } as never);
}

describe('FinancialService student transaction boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('stops before balance settlement when the active student session is gone', async () => {
    const activeSessionRequired = Object.assign(
      new Error('ACTIVE_SESSION_REQUIRED'),
      { code: 'ACTIVE_SESSION_REQUIRED' },
    );
    attribute.mockImplementation(() => {
      throw activeSessionRequired;
    });
    const settle = jest.spyOn(settlementService, 'settle');
    const startingBalance = db.data?.balance ?? 0;
    const req = {
      get: jest.fn(() => ''),
      body: { mode: 'invalid' },
    } as unknown as Request;

    await expect(service({}).confirmPayment(req, response())).rejects.toBe(
      activeSessionRequired,
    );

    expect(settle).not.toHaveBeenCalled();
    expect(db.data?.balance ?? 0).toBe(startingBalance);
  });

  test('attributes the definitive print transaction exactly once', async () => {
    attribute.mockReturnValue(undefined);
    const req = {
      get: jest.fn(() => ''),
      body: { mode: 'print' },
    } as unknown as Request;
    const studentSessionService = {};

    await service(studentSessionService).confirmPayment(req, response());

    expect(attribute).toHaveBeenCalledTimes(1);
    expect(attribute).toHaveBeenCalledWith(
      studentSessionService,
      expect.stringMatching(/^[0-9a-f-]{36}$/),
      'print',
    );
  });
});
