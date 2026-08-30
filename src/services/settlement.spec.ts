import type { Server } from 'socket.io';
import { settlementService, settleTerminal, holdEscrow, type TerminalSettlementInput } from './settlement';
import { db, type Schema } from './db';
import { hopperService } from './hopper';

jest.mock('./db', () => ({
  db: {
    data: {
      balance: 10,
      earnings: 100,
      owedChanges: [],
    },
    write: jest.fn().mockResolvedValue(undefined),
  },
  withBalanceLock: (cb: () => Promise<unknown>) => cb(),
}));

jest.mock('./hopper', () => ({
  hopperService: {
    dispenseChange: jest.fn(),
  },
}));

jest.mock('./admin', () => ({
  adminService: {
    appendAdminLog: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('./time-source', () => ({
  assertTrustedTimeForFinancialOperation: jest.fn(),
  getTrustedTimestamp: jest.fn().mockReturnValue({
    timestamp: '2026-08-30T00:00:00.000Z',
    meta: { source: 'system', synced: true },
  }),
}));

describe('SettlementService - Escrow & Terminal Settlement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.data = {
      balance: 10,
      earnings: 100,
      owedChanges: [],
    } as unknown as Schema;
    db.write = jest.fn().mockResolvedValue(undefined);
  });

  it('settles partial print job and dispenses remaining balance (change + unprinted refund)', async () => {
    (hopperService.dispenseChange as jest.Mock).mockResolvedValue({
      ok: true,
      dispensedCoins: 4,
      attempts: 1,
    });

    const mockIo = { emit: jest.fn() } as unknown as Server;

    const input: TerminalSettlementInput = {
      escrowBalance: 10,
      actualChargedAmount: 6, // 2 pages @ 3 PHP
      io: mockIo,
      jobContext: {
        mode: 'print',
        jobId: 'job-123',
        transactionId: 'tx-123',
        spoolerCorrelationKey: 'key-123',
        pagesPrinted: 2,
        totalPages: 3,
        terminalReason: 'paper_out_cancelled',
      },
    };

    const result = await settlementService.settleTerminal(input);

    expect(result.ok).toBe(true);
    expect(result.chargedAmount).toBe(6);
    expect(result.previousBalance).toBe(10);
    expect(result.remainingBalance).toBe(0);
    expect(result.earnings).toBe(106);
    expect(result.change.requested).toBe(4);
    expect(result.change.dispensed).toBe(4);
    expect(result.change.state).toBe('dispensed');
    expect(hopperService.dispenseChange).toHaveBeenCalledWith(4);
    expect(db.data!.balance).toBe(0);
    expect(db.data!.earnings).toBe(106);
    expect(db.write).toHaveBeenCalled();
    expect(mockIo.emit).toHaveBeenCalledWith('balance', 0);
    expect(mockIo.emit).toHaveBeenCalledWith('changeDispenseStatus', {
      state: 'dispensing',
      amount: 4,
      mode: 'print',
      transactionId: 'tx-123',
      spoolerCorrelationKey: 'key-123',
      breakdown: {
        totalInserted: 10,
        actualCharged: 6,
        refundAndChange: 4,
      },
    });
    expect(mockIo.emit).toHaveBeenCalledWith('changeDispenseStatus', {
      state: 'dispensed',
      amount: 4,
      dispensed: 4,
      attempts: 1,
      mode: 'print',
      transactionId: 'tx-123',
      spoolerCorrelationKey: 'key-123',
    });
  });

  it('settles with zero change when exact amount charged', async () => {
    db.data!.balance = 6;
    const mockIo = { emit: jest.fn() } as unknown as Server;

    const result = await settlementService.settleTerminal({
      escrowBalance: 6,
      actualChargedAmount: 6,
      io: mockIo,
      jobContext: {
        mode: 'print',
        transactionId: 'tx-exact',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.chargedAmount).toBe(6);
    expect(result.change.requested).toBe(0);
    expect(result.change.dispensed).toBe(0);
    expect(result.change.state).toBe('none');
    expect(hopperService.dispenseChange).not.toHaveBeenCalled();
    expect(db.data!.balance).toBe(0);
    expect(db.data!.earnings).toBe(106);
    expect(mockIo.emit).toHaveBeenCalledWith('balance', 0);
  });

  it('handles hopper shortfall and records owedChange', async () => {
    (hopperService.dispenseChange as jest.Mock).mockResolvedValue({
      ok: false,
      dispensedCoins: 2,
      attempts: 3,
      message: 'Hopper motor timeout',
    });

    const mockIo = { emit: jest.fn() } as unknown as Server;

    const result = await settleTerminal({
      escrowBalance: 10,
      actualChargedAmount: 6,
      io: mockIo,
      jobContext: {
        mode: 'print',
        transactionId: 'tx-jam',
        spoolerCorrelationKey: 'key-jam',
        pagesPrinted: 2,
        totalPages: 3,
        terminalReason: 'hopper_jam',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.chargedAmount).toBe(6);
    expect(result.change.requested).toBe(4);
    expect(result.change.dispensed).toBe(2);
    expect(result.change.state).toBe('failed');
    expect(result.change.owedChangeId).toBeDefined();
    expect(db.data!.owedChanges).toHaveLength(1);
    expect(db.data!.owedChanges[0].amount).toBe(2);
    expect(mockIo.emit).toHaveBeenCalledWith('changeDispenseStatus', expect.objectContaining({
      state: 'failed',
      amount: 4,
      dispensed: 2,
      attempts: 3,
    }));
  });

  it('settles full unprinted refund when actualChargedAmount is 0', async () => {
    (hopperService.dispenseChange as jest.Mock).mockResolvedValue({
      ok: true,
      dispensedCoins: 10,
      attempts: 1,
    });

    const mockIo = { emit: jest.fn() } as unknown as Server;

    const result = await settlementService.settleTerminal({
      escrowBalance: 10,
      actualChargedAmount: 0,
      io: mockIo,
      jobContext: {
        mode: 'print',
        transactionId: 'tx-full-refund',
        pagesPrinted: 0,
        totalPages: 3,
        terminalReason: 'paper_out_aborted',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.chargedAmount).toBe(0);
    expect(result.change.requested).toBe(10);
    expect(result.change.dispensed).toBe(10);
    expect(db.data!.balance).toBe(0);
    expect(db.data!.earnings).toBe(100);
    expect(hopperService.dispenseChange).toHaveBeenCalledWith(10);
  });

  it('holds escrow when sufficient balance exists', async () => {
    db.data!.balance = 15;
    const result = await holdEscrow({
      requiredAmount: 10,
      jobContext: { mode: 'print', transactionId: 'tx-hold' },
    });

    expect(result.ok).toBe(true);
    expect(result.heldAmount).toBe(10);
    expect(result.currentBalance).toBe(15);
  });

  it('fails holding escrow when balance is insufficient', async () => {
    db.data!.balance = 5;
    const result = await holdEscrow({
      requiredAmount: 10,
      jobContext: { mode: 'print', transactionId: 'tx-hold-fail' },
    });

    expect(result.ok).toBe(false);
    expect(result.heldAmount).toBe(0);
    expect(result.currentBalance).toBe(5);
    expect(result.error).toBe('Insufficient balance');
  });
});
