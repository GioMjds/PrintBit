import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import { db, withBalanceLock, type OwedChangeEntry } from './db';
import { adminService } from './admin';
import { hopperService, type HopperDispenseResult } from './hopper';
import { assertTrustedTimeForFinancialOperation } from './time-source';

export interface SettlementInput {
  requiredAmount: number;
  io: Server;
  jobContext: {
    mode: 'print' | 'copy' | 'scan';
    jobId?: string;
    [key: string]: string | number | boolean | null | undefined;
  };
}

export interface TerminalSettlementInput {
  escrowBalance: number;
  actualChargedAmount: number;
  io: Server;
  jobContext: {
    mode: 'print' | 'copy' | 'scan';
    jobId?: string;
    transactionId?: string | null;
    spoolerCorrelationKey?: string | null;
    pagesPrinted?: number;
    totalPages?: number;
    terminalReason?: string;
    [key: string]: unknown;
  };
}

export interface HoldEscrowInput {
  requiredAmount: number;
  jobContext?: {
    mode: 'print' | 'copy' | 'scan';
    transactionId?: string | null;
    [key: string]: unknown;
  };
}

export interface HoldEscrowResult {
  ok: boolean;
  heldAmount: number;
  currentBalance: number;
  error?: string;
}

export interface SettlementResult {
  ok: boolean;
  chargedAmount: number;
  previousBalance: number;
  remainingBalance: number;
  earnings: number;
  change: {
    requested: number;
    dispensed: number;
    state: 'none' | 'dispensing' | 'dispensed' | 'failed';
    attempts?: number;
    owedChangeId?: string | null;
    message?: string;
  };
  error?: string;
}

class SettlementService {
  async holdEscrow(input: HoldEscrowInput): Promise<HoldEscrowResult> {
    const { requiredAmount, jobContext } = input;
    if (jobContext?.mode) {
      assertTrustedTimeForFinancialOperation(
        `settlement:${jobContext.mode}:hold`,
      );
    }
    return withBalanceLock(async () => {
      const currentBalance = db.data?.balance ?? 0;
      if (currentBalance < requiredAmount) {
        return {
          ok: false,
          heldAmount: 0,
          currentBalance,
          error: 'Insufficient balance',
        };
      }
      return {
        ok: true,
        heldAmount: requiredAmount,
        currentBalance,
      };
    });
  }

  async settle(input: SettlementInput): Promise<SettlementResult> {
    const { requiredAmount, io, jobContext } = input;
    assertTrustedTimeForFinancialOperation(`settlement:${jobContext.mode}`);
    const transactionId =
      typeof jobContext.transactionId === 'string'
        ? jobContext.transactionId
        : null;
    const spoolerCorrelationKey =
      typeof jobContext.spoolerCorrelationKey === 'string' &&
      jobContext.spoolerCorrelationKey.trim().length > 0
        ? jobContext.spoolerCorrelationKey.trim()
        : null;

    return withBalanceLock(async () => {
      const currentBalance = db.data?.balance ?? 0;

      if (currentBalance < requiredAmount) {
        void adminService.appendAdminLog(
          'payment_failed',
          `Settlement failed: insufficient balance after ${jobContext.mode} dispatch.`,
          {
            balance: currentBalance,
            requiredAmount,
            mode: jobContext.mode,
            jobId: jobContext.jobId ?? null,
          },
        );
        return {
          ok: false,
          chargedAmount: 0,
          previousBalance: currentBalance,
          remainingBalance: currentBalance,
          earnings: db.data!.earnings,
          change: { requested: 0, dispensed: 0, state: 'none' as const },
          error: 'Insufficient balance',
        };
      }

      const previousBalance = db.data!.balance;
      const changeAmount = previousBalance - requiredAmount;
      db.data!.balance = 0;
      db.data!.earnings += requiredAmount;
      await db.write();
      io.emit('balance', 0);

      if (changeAmount <= 0) {
        return {
          ok: true,
          chargedAmount: requiredAmount,
          previousBalance,
          remainingBalance: 0,
          earnings: db.data!.earnings,
          change: { requested: 0, dispensed: 0, state: 'none' as const },
        };
      }

      io.emit('changeDispenseStatus', {
        state: 'dispensing',
        amount: changeAmount,
        mode: jobContext.mode,
        transactionId,
        spoolerCorrelationKey,
      });

      const dispenseResult: HopperDispenseResult =
        await hopperService.dispenseChange(changeAmount);
      const dispensedAmount = Math.max(
        0,
        Math.min(changeAmount, Math.floor(dispenseResult.dispensedCoins)),
      );

      if (dispenseResult.ok) {
        io.emit('changeDispenseStatus', {
          state: 'dispensed',
          amount: changeAmount,
          dispensed: dispensedAmount,
          attempts: dispenseResult.attempts,
          mode: jobContext.mode,
          transactionId,
          spoolerCorrelationKey,
        });
        return {
          ok: true,
          chargedAmount: requiredAmount,
          previousBalance,
          remainingBalance: 0,
          earnings: db.data!.earnings,
          change: {
            requested: changeAmount,
            dispensed: dispensedAmount,
            state: 'dispensed' as const,
            attempts: dispenseResult.attempts,
          },
        };
      }

      io.emit('changeDispenseStatus', {
        state: 'failed',
        amount: changeAmount,
        dispensed: dispensedAmount,
        attempts: dispenseResult.attempts,
        owedChangeId: dispenseResult.owedChangeId ?? null,
        message: dispenseResult.message,
        mode: jobContext.mode,
        transactionId,
        spoolerCorrelationKey,
      });
      return {
        ok: true,
        chargedAmount: requiredAmount,
        previousBalance,
        remainingBalance: 0,
        earnings: db.data!.earnings,
        change: {
          requested: changeAmount,
          dispensed: dispensedAmount,
          state: 'failed' as const,
          attempts: dispenseResult.attempts,
          owedChangeId: dispenseResult.owedChangeId ?? null,
          message: dispenseResult.message,
        },
      };
    });
  }

  async settleTerminal(
    input: TerminalSettlementInput,
  ): Promise<SettlementResult> {
    const { escrowBalance, actualChargedAmount, io, jobContext } = input;
    assertTrustedTimeForFinancialOperation(
      `settlement:${jobContext.mode}:terminal`,
    );

    const transactionId =
      typeof jobContext.transactionId === 'string'
        ? jobContext.transactionId
        : null;
    const spoolerCorrelationKey =
      typeof jobContext.spoolerCorrelationKey === 'string' &&
      jobContext.spoolerCorrelationKey.trim().length > 0
        ? jobContext.spoolerCorrelationKey.trim()
        : null;

    return withBalanceLock(async () => {
      const currentBalance = db.data?.balance ?? 0;
      const effectiveBalance = Math.max(currentBalance, escrowBalance);
      const charge = Math.min(
        effectiveBalance,
        Math.max(0, actualChargedAmount),
      );
      const changeAmount = effectiveBalance - charge;

      db.data!.balance = 0;
      db.data!.earnings += charge;
      await db.write();
      io.emit('balance', 0);

      if (changeAmount <= 0) {
        return {
          ok: true,
          chargedAmount: charge,
          previousBalance: effectiveBalance,
          remainingBalance: 0,
          earnings: db.data!.earnings,
          change: { requested: 0, dispensed: 0, state: 'none' as const },
        };
      }

      io.emit('changeDispenseStatus', {
        state: 'dispensing',
        amount: changeAmount,
        mode: jobContext.mode,
        transactionId,
        spoolerCorrelationKey,
        breakdown: {
          totalInserted: effectiveBalance,
          actualCharged: charge,
          refundAndChange: changeAmount,
        },
      });

      const dispenseResult: HopperDispenseResult =
        await hopperService.dispenseChange(changeAmount);
      const dispensedAmount = Math.max(
        0,
        Math.min(changeAmount, Math.floor(dispenseResult.dispensedCoins ?? 0)),
      );

      if (dispenseResult.ok) {
        io.emit('changeDispenseStatus', {
          state: 'dispensed',
          amount: changeAmount,
          dispensed: dispensedAmount,
          attempts: dispenseResult.attempts,
          mode: jobContext.mode,
          transactionId,
          spoolerCorrelationKey,
        });

        return {
          ok: true,
          chargedAmount: charge,
          previousBalance: effectiveBalance,
          remainingBalance: 0,
          earnings: db.data!.earnings,
          change: {
            requested: changeAmount,
            dispensed: dispensedAmount,
            state: 'dispensed' as const,
            attempts: dispenseResult.attempts,
          },
        };
      }

      // Handle hopper shortfall / jam with owedChange
      const owedAmount = changeAmount - dispensedAmount;
      let owedChangeId: string | null = dispenseResult.owedChangeId ?? null;
      if (owedAmount > 0 && !owedChangeId) {
        owedChangeId = randomUUID();
        db.data!.owedChanges = db.data!.owedChanges ?? [];
        const owedEntry: OwedChangeEntry = {
          id: owedChangeId,
          amount: owedAmount,
          reason: `Hopper dispense shortfall during ${jobContext.mode} terminal settlement`,
          status: 'open',
          timestamp: new Date().toISOString(),
          meta: {
            transactionId,
            mode: jobContext.mode,
            pagesPrinted: jobContext.pagesPrinted ?? null,
            totalPages: jobContext.totalPages ?? null,
            terminalReason: jobContext.terminalReason ?? null,
          },
        };
        db.data!.owedChanges.push(owedEntry);
        await db.write();
      }

      io.emit('changeDispenseStatus', {
        state: 'failed',
        amount: changeAmount,
        dispensed: dispensedAmount,
        attempts: dispenseResult.attempts,
        owedChangeId,
        message: dispenseResult.message ?? 'Coin dispenser error',
        mode: jobContext.mode,
        transactionId,
        spoolerCorrelationKey,
      });

      return {
        ok: false,
        chargedAmount: charge,
        previousBalance: effectiveBalance,
        remainingBalance: 0,
        earnings: db.data!.earnings,
        change: {
          requested: changeAmount,
          dispensed: dispensedAmount,
          state: 'failed' as const,
          attempts: dispenseResult.attempts,
          owedChangeId,
          message: dispenseResult.message ?? 'Coin dispenser error',
        },
        error: dispenseResult.message ?? 'Hopper dispense failed',
      };
    });
  }
}

export const settlementService = new SettlementService();
export const settleTerminal = settlementService.settleTerminal.bind(settlementService);
export const holdEscrow = settlementService.holdEscrow.bind(settlementService);
