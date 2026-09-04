import { hopperService } from '../hopper';
import { db } from '../db';
import { sendWorkerRequest } from '../worker-command-pipe';
import { getHopperStatus } from '../hardware-state-projection';

jest.mock('../worker-command-pipe', () => ({
  sendWorkerRequest: jest.fn(),
  sendWorkerCommand: jest.fn(),
}));

jest.mock('../hardware-state-projection', () => ({
  getHopperStatus: jest.fn().mockReturnValue({
    connected: true,
    pending: false,
    portPath: 'COM3',
    lastError: null,
    lastSuccessAt: null,
  }),
}));

jest.mock('../db', () => ({
  db: {
    data: {
      hopperSettings: {
        enabled: true,
        retryCount: 1,
        timeoutMs: 5000,
      },
      hopperStats: {
        totalDispensed: 0,
        dispenseAttempts: 0,
        dispenseSuccess: 0,
        dispenseFailures: 0,
        lastDispensedAt: null,
        lastError: null,
        selfTestPassed: false,
        lastSelfTestAt: null,
      },
      owedChanges: [],
    },
    write: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../admin', () => ({
  adminService: {
    appendAdminLog: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../anomaly', () => ({
  anomalyService: {
    report: jest.fn().mockResolvedValue(undefined),
  },
  buildAnomalyFingerprint: jest.fn().mockReturnValue('fingerprint'),
  mapHopperErrorSeverity: jest.fn().mockReturnValue('warning'),
}));

describe('hopperService - Worker Command Pipe Delegation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.data!.owedChanges = [];
    (getHopperStatus as jest.Mock).mockReturnValue({
      connected: true,
      pending: false,
      portPath: 'COM3',
      lastError: null,
      lastSuccessAt: null,
    });
  });

  it('delegates dispenseChange to worker command pipe and returns success', async () => {
    (sendWorkerRequest as jest.Mock).mockResolvedValue({
      requestId: 'test-req',
      type: 'DispenseCoins',
      success: true,
      dispensedCoins: 5,
      errorCode: null,
      message: 'Dispense ok',
    });

    const result = await hopperService.dispenseChange(5);

    expect(sendWorkerRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'DispenseCoins',
        coinCount: 5,
      }),
      expect.any(Object),
    );

    expect(result.ok).toBe(true);
    expect(result.dispensedCoins).toBe(5);
    expect(result.amount).toBe(5);
  });

  it('records owed change when worker command returns failure', async () => {
    (sendWorkerRequest as jest.Mock).mockResolvedValue({
      requestId: 'test-req-fail',
      type: 'DispenseCoins',
      success: false,
      dispensedCoins: 2,
      errorCode: 'TIMEOUT',
      message: 'Hopper motor timeout',
    });

    const result = await hopperService.dispenseChange(10);

    expect(result.ok).toBe(false);
    expect(result.dispensedCoins).toBe(2);
    expect(result.owedChangeId).toBeDefined();
    expect(db.data!.owedChanges.length).toBe(1);
    expect(db.data!.owedChanges[0].amount).toBe(8);
  });
});
