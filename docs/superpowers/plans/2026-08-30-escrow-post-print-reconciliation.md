# Escrow & Post-Print Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the kiosk payment and print lifecycle so money is held in escrow during printing, change is dispensed only after physical output, unprinted pages are automatically refunded (e.g. ₱4 dispensed for 2/3 pages printed from ₱10), and operators can remotely resume or cancel stuck jobs from the Admin Panel.

**Architecture:** Transition from upfront settlement to an Escrow & Post-Print Reconciliation architecture. Money inserted remains in session escrow balance during printing; Windows Spooler telemetry (`System.Printing`) monitors real-time `NumberOfPagesPrinted` and `IsOutOfPaper` status. On terminal completion or failure, the system computes the exact charge for completed pages, purges remaining spooler queues, and executes a single payout of change + refund via the coin hopper, with remote supervisor controls in the Admin Dashboard.

**Tech Stack:** TypeScript, Node.js, Express.js, PowerShell (`System.Printing`), Socket.IO, SQLite (`better-sqlite3`), ESP32 Serial Protocol, HTML5/CSS/Vanilla TS.

**Spec:** Redesign the payment, spooler supervision, and refund model to fix the upfront change dispense flaw and provide remote administrative recovery.

## Global Constraints

- All financial calculations must strictly use integer centavos or normalized currencies without floating-point drift.
- Spooler operations (`Pause`, `Resume`, `Cancel`) must route through the warm persistent PowerShell runspace in `src/services/powershell-runspace.ts` with mutual exclusion (`AsyncMutex`).
- Hardware coin hopper dispense must only be triggered once the print job reaches a terminal state (`completed`, `cancelled_on_error`, `cancelled_by_admin`, `paper_out_aborted`).
- ESP32 hardware inhibit must be asserted when the printer is in an unrecoverable out-of-paper state to block new coin/bill insertions.

---

### Task 1: Escrow & Deferred Post-Print Settlement Service

**Files:**

- Modify: `src/services/settlement.ts`
- Modify: `src/modules/financial/financial.service.ts`
- Test: `src/services/settlement.spec.ts`

**Interfaces:**

- Consumes: `withBalanceLock`, `db`, `hopperService.dispenseChange`, `financialLedgerService`
- Produces: `settlementService.holdEscrow(input)`, `settlementService.settleTerminal(input)`

- [ ] **Step 1: Write the failing test for escrow and deferred settlement**

```typescript
// src/services/settlement.spec.ts
import { settlementService, type TerminalSettlementInput } from './settlement';
import { db } from './db';
import { hopperService } from './hopper';

jest.mock('./hopper', () => ({
  hopperService: {
    dispenseChange: jest.fn(),
  },
}));

describe('SettlementService - Escrow & Terminal Settlement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.data = {
      balance: 10,
      earnings: 100,
      owedChanges: [],
    } as any;
  });

  it('settles partial print job and dispenses remaining balance (change + unprinted refund)', async () => {
    (hopperService.dispenseChange as jest.Mock).mockResolvedValue({
      ok: true,
      dispensedCoins: 4,
      attempts: 1,
    });

    const mockIo = { emit: jest.fn() } as any;

    const result = await settlementService.settleTerminal({
      escrowBalance: 10,
      actualChargedAmount: 6, // 2 pages @ 3 PHP
      io: mockIo,
      jobContext: {
        mode: 'print',
        jobId: 'job-123',
        transactionId: 'tx-123',
        pagesPrinted: 2,
        totalPages: 3,
        terminalReason: 'paper_out_cancelled',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.chargedAmount).toBe(6);
    expect(result.change.requested).toBe(4);
    expect(result.change.dispensed).toBe(4);
    expect(hopperService.dispenseChange).toHaveBeenCalledWith(4);
    expect(db.data!.balance).toBe(0);
    expect(db.data!.earnings).toBe(106);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/services/settlement.spec.ts`
Expected: FAIL with "settleTerminal is not a function"

- [ ] **Step 3: Implement `settleTerminal` and deferred settlement in `src/services/settlement.ts`**

```typescript
// Add to src/services/settlement.ts
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

export async function settleTerminal(
  input: TerminalSettlementInput,
): Promise<SettlementResult> {
  const { escrowBalance, actualChargedAmount, io, jobContext } = input;
  assertTrustedTimeForFinancialOperation(
    `settlement:${jobContext.mode}:terminal`,
  );

  return withBalanceLock(async () => {
    const currentBalance = db.data?.balance ?? 0;
    const effectiveBalance = Math.max(currentBalance, escrowBalance);
    const charge = Math.min(effectiveBalance, Math.max(0, actualChargedAmount));
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
      transactionId: jobContext.transactionId ?? null,
      spoolerCorrelationKey: jobContext.spoolerCorrelationKey ?? null,
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
      Math.min(changeAmount, Math.floor(dispenseResult.dispensedCoins)),
    );

    if (dispenseResult.ok) {
      io.emit('changeDispenseStatus', {
        state: 'dispensed',
        amount: changeAmount,
        dispensed: dispensedAmount,
        attempts: dispenseResult.attempts,
        mode: jobContext.mode,
        transactionId: jobContext.transactionId ?? null,
        spoolerCorrelationKey: jobContext.spoolerCorrelationKey ?? null,
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
    let owedChangeId: string | null = null;
    if (owedAmount > 0) {
      owedChangeId = randomUUID();
      db.data!.owedChanges = db.data!.owedChanges ?? [];
      db.data!.owedChanges.push({
        id: owedChangeId,
        amountOwed: owedAmount,
        transactionId: jobContext.transactionId ?? null,
        createdAt: new Date().toISOString(),
        status: 'open',
      });
      await db.write();
    }

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
        message: dispenseResult.error ?? 'Coin dispenser error',
      },
      error: dispenseResult.error ?? 'Hopper dispense failed',
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/services/settlement.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/services/settlement.ts src/services/settlement.spec.ts
git commit -m "feat(financial): add deferred escrow terminal settlement service"
```

---

### Task 2: Real-Time Spooler Page Tracking & Mid-Job Paper-Out Detection

**Files:**

- Modify: `src/services/windows-printer-edge.ts`
- Modify: `src/services/printer-monitor.ts`
- Modify: `src/modules/printer/printer.service.ts`
- Test: `src/modules/printer/printer.service.spec.ts`

**Interfaces:**

- Consumes: `System.Printing.PrintSystemJobInfo`
- Produces: `queryActiveJobProgressViaEdge(printerName, jobId)`, `onJobInterrupted(callback)`

- [ ] **Step 1: Write failing test for active job progress query and interruption detection**

```typescript
// In src/modules/printer/printer.service.spec.ts
describe('PrinterService - Mid-job paper out tracking', () => {
  it('detects mid-job paper-out and reports exact pages completed', async () => {
    const mockProgress = {
      jobId: 101,
      pagesPrinted: 2,
      totalPages: 3,
      isOutOfPaper: true,
      isPaused: true,
      isError: true,
      status: 'PaperOut',
    };

    const telemetry = await printerService.evaluateJobProgress(mockProgress);
    expect(telemetry.interrupted).toBe(true);
    expect(telemetry.reason).toBe('out_of_paper');
    expect(telemetry.confirmedPagesPrinted).toBe(2);
    expect(telemetry.unprintedPages).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/modules/printer/printer.service.spec.ts`
Expected: FAIL with method missing

- [ ] **Step 3: Implement active job progress query in `src/services/windows-printer-edge.ts` and `src/modules/printer/printer.service.ts`**

```powershell
# Add to windows-printer-edge.ts queryActiveJobProgressViaEdge:
$queue = New-Object System.Printing.PrintQueue($ps, '${escaped}')
$queue.Refresh()
$job = $queue.GetPrintJobInfoCollection() | Where-Object { $_.JobIdentifier -eq ${jobId} }
if ($job) {
  @{
    jobId        = $job.JobIdentifier
    pagesPrinted = $job.NumberOfPagesPrinted
    totalPages   = $job.NumberOfPages
    isOutOfPaper = [bool]($job.JobStatus -band [System.Printing.PrintJobStatus]::PaperOut)
    isPaused     = [bool]$job.IsPaused
    isCompleted  = [bool]$job.IsCompleted
    isDeleting   = [bool]$job.IsDeleting
    status       = $job.JobStatus.ToString()
  } | ConvertTo-Json -Compress
}
```

```typescript
// In src/modules/printer/printer.service.ts
export interface ActiveJobProgress {
  jobId: number;
  pagesPrinted: number;
  totalPages: number;
  isOutOfPaper: boolean;
  isPaused: boolean;
  isCompleted: boolean;
  isDeleting: boolean;
  status: string;
}

export function evaluateJobProgress(progress: ActiveJobProgress) {
  const isOutOfPaper =
    progress.isOutOfPaper || progress.status.toLowerCase().includes('paperout');
  const interrupted =
    isOutOfPaper ||
    (progress.isPaused && progress.pagesPrinted < progress.totalPages);
  const confirmedPagesPrinted = Math.max(
    0,
    Math.min(progress.pagesPrinted, progress.totalPages),
  );
  const unprintedPages = Math.max(
    0,
    progress.totalPages - confirmedPagesPrinted,
  );

  return {
    interrupted,
    reason: isOutOfPaper
      ? 'out_of_paper'
      : progress.isPaused
        ? 'paused_error'
        : 'none',
    confirmedPagesPrinted,
    unprintedPages,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/modules/printer/printer.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/services/windows-printer-edge.ts src/modules/printer/printer.service.ts src/modules/printer/printer.service.spec.ts
git commit -m "feat(printer): implement active job telemetry and mid-job paper-out detection"
```

---

### Task 3: Automatic Partial Refund & Single-Hop Payout on Mid-Job Error

**Files:**

- Modify: `src/modules/financial/financial.service.ts`
- Modify: `src/modules/printer/printer.service.ts`
- Test: `src/modules/financial/financial.service.spec.ts`

**Interfaces:**

- Consumes: `cancelPrintJobViaEdge`, `settleTerminal`, `financialLedgerService`
- Produces: `handleMidJobInterruption({ correlationKey, reason, confirmedPages })`

- [ ] **Step 1: Write failing test for partial refund computation & payout**

```typescript
// In src/modules/financial/financial.service.spec.ts
describe('FinancialService - Mid-Job Paper Out Payout', () => {
  it('cancels spooler job, charges 6 PHP for 2 printed pages, and dispenses 4 PHP total', async () => {
    const refundResult = await financialService.handleMidJobCancellation({
      transactionId: 'tx-print-456',
      totalInserted: 10,
      unitPricePerPage: 3,
      totalPages: 3,
      pagesPrinted: 2,
      spoolerJobId: 101,
      printerName: 'EPSON_L3210',
    });

    expect(refundResult.chargedAmount).toBe(6);
    expect(refundResult.refundAmount).toBe(3);
    expect(refundResult.originalChange).toBe(1);
    expect(refundResult.totalDispensed).toBe(4);
    expect(refundResult.itemizedBreakdown).toEqual({
      totalInserted: 10,
      pagesPrinted: 2,
      printedCharge: 6,
      unprintedPages: 1,
      unprintedRefund: 3,
      originalChange: 1,
      totalDispensed: 4,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/modules/financial/financial.service.spec.ts`
Expected: FAIL with method undefined

- [ ] **Step 3: Implement `handleMidJobCancellation` in `src/modules/financial/financial.service.ts`**

```typescript
// Add to src/modules/financial/financial.service.ts
export async function handleMidJobCancellation(params: {
  transactionId: string;
  totalInserted: number;
  unitPricePerPage: number;
  totalPages: number;
  pagesPrinted: number;
  spoolerJobId?: number;
  printerName?: string;
}) {
  const {
    totalInserted,
    unitPricePerPage,
    totalPages,
    pagesPrinted,
    spoolerJobId,
    printerName,
  } = params;

  // 1. Purge spooler job to unblock OS queue and kill vendor popups
  if (printerName && typeof spoolerJobId === 'number') {
    await cancelPrintJobViaEdge(printerName, spoolerJobId);
    try {
      await execFileAsync('taskkill', ['/F', '/IM', 'e_yarnyre.exe'], {
        timeout: 2000,
      });
    } catch {}
  }

  // 2. Compute exact itemized financial amounts
  const safePagesPrinted = Math.max(0, Math.min(pagesPrinted, totalPages));
  const printedCharge = safePagesPrinted * unitPricePerPage;
  const unprintedPages = totalPages - safePagesPrinted;
  const unprintedRefund = unprintedPages * unitPricePerPage;
  const originalExpectedCost = totalPages * unitPricePerPage;
  const originalChange = Math.max(0, totalInserted - originalExpectedCost);
  const totalDispensed = totalInserted - printedCharge;

  // 3. Execute terminal settlement and dispense single payout
  const settlement = await settlementService.settleTerminal({
    escrowBalance: totalInserted,
    actualChargedAmount: printedCharge,
    io: getGlobalSocketIo(),
    jobContext: {
      mode: 'print',
      transactionId: params.transactionId,
      pagesPrinted: safePagesPrinted,
      totalPages,
      terminalReason: 'paper_out_auto_refund',
    },
  });

  return {
    chargedAmount: printedCharge,
    refundAmount: unprintedRefund,
    originalChange,
    totalDispensed: settlement.change.dispensed,
    itemizedBreakdown: {
      totalInserted,
      pagesPrinted: safePagesPrinted,
      printedCharge,
      unprintedPages,
      unprintedRefund,
      originalChange,
      totalDispensed,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/modules/financial/financial.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/modules/financial/financial.service.ts src/modules/financial/financial.service.spec.ts
git commit -m "feat(financial): add itemized mid-job cancellation settlement and payout"
```

---

### Task 4: Admin Panel Active Job Supervisor & Remote Controls

**Files:**

- Modify: `src/modules/admin/admin.controller.ts`
- Modify: `src/public/admin/dashboard/index.html`
- Modify: `src/public/admin/dashboard/app.ts`
- Test: `src/modules/admin/admin.controller.spec.ts`

**Interfaces:**

- Consumes: `POST /api/printer/resume`, `POST /api/printer/cancel-remaining`
- Produces: Admin Dashboard Active Job Card with real-time status and action buttons

- [ ] **Step 1: Write failing test for admin active job supervision endpoint**

```typescript
// In src/modules/admin/admin.controller.spec.ts
describe('AdminController - Active Job Supervision', () => {
  it('returns current active job telemetry and actions', async () => {
    const res = await request(app)
      .get('/api/admin/active-print-job')
      .set('Cookie', [`admin_token=${validAdminToken}`]);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('activeJob');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/modules/admin/admin.controller.spec.ts`
Expected: FAIL with 404 Route Not Found

- [ ] **Step 3: Implement endpoint and Admin UI Card**

```typescript
// In src/modules/admin/admin.controller.ts
this.router.get('/active-print-job', this.requireAuth, async (_req, res) => {
  const activeJob = await this.printerService.getActiveJobSummary();
  res.json({ ok: true, activeJob });
});
```

```html
<!-- Add to src/public/admin/dashboard/index.html -->
<div class="admin-card active-job-card" id="activeJobCard" hidden>
  <div class="active-job-header">
    <h3>⚠️ Active Print Job Supervisor</h3>
    <span class="badge" id="jobStatusBadge">Paused (Out of Paper)</span>
  </div>
  <div class="active-job-details">
    <p><strong>Document:</strong> <span id="activeJobDocName">-</span></p>
    <p>
      <strong>Progress:</strong> <span id="activeJobPages">2 / 3 pages</span>
    </p>
    <p>
      <strong>Escrow Balance:</strong> ₱<span id="activeJobBalance">10.00</span>
    </p>
  </div>
  <div class="active-job-actions">
    <button class="btn btn-primary" id="btnResumeJob">
      🔄 Refilled Paper & Resume Print
    </button>
    <button class="btn btn-danger" id="btnCancelJob">
      🛑 Cancel Job & Auto-Refund
    </button>
  </div>
</div>
```

```typescript
// Add to src/public/admin/dashboard/app.ts
btnResumeJob?.addEventListener('click', async () => {
  if (!confirm('Have you refilled paper into the printer tray?')) return;
  const res = await fetch('/api/printer/resume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spoolerCorrelationKey: currentActiveJobKey }),
  });
  if (res.ok) alert('Resume signal sent to printer.');
});

btnCancelJob?.addEventListener('click', async () => {
  if (!confirm('Cancel remaining pages and dispense refund to customer?'))
    return;
  const res = await fetch('/api/printer/cancel-remaining', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spoolerCorrelationKey: currentActiveJobKey }),
  });
  if (res.ok) alert('Job cancelled and refund dispensed.');
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/modules/admin/admin.controller.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/modules/admin/admin.controller.ts src/public/admin/dashboard/index.html src/public/admin/dashboard/app.ts
git commit -m "feat(admin): add active job supervisor card and remote resume/cancel actions"
```

---

### Task 5: Hardware Inhibit & Kiosk Breakdown Screen

**Files:**

- Modify: `src/public/confirm/index.html`
- Modify: `src/public/confirm/app.ts`
- Modify: `src/services/esp32.ts`
- Test: `src/modules/printer/printer.guard.spec.ts`

**Interfaces:**

- Consumes: Socket events `changeDispenseStatus` with `breakdown`, `printerStatus`
- Produces: Clear on-screen breakdown modal & ESP32 pin inhibit

- [ ] **Step 1: Write failing test for paper-out hardware inhibit guard**

```typescript
// In src/modules/printer/printer.guard.spec.ts
describe('PrinterGuard - Paper Out Hardware Inhibit', () => {
  it('inhibits coin acceptor when printer reports out of paper', async () => {
    const esp32Spy = jest.spyOn(esp32Service, 'setCoinAcceptorInhibited');
    await printerGuard.evaluateHardwareState({ isOutOfPaper: true });
    expect(esp32Spy).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/modules/printer/printer.guard.spec.ts`
Expected: FAIL with assertion failure

- [ ] **Step 3: Implement breakdown UI in `confirm/index.html` and ESP32 inhibit**

```html
<!-- In src/public/confirm/index.html -->
<div class="modal refund-breakdown-modal" id="refundBreakdownModal" hidden>
  <div class="modal-content">
    <div class="modal-icon warning">⚠️</div>
    <h2>Printer Out of Paper</h2>
    <p>Your print job could not finish because the printer ran out of paper.</p>
    <div class="breakdown-table">
      <div class="row">
        <span>Total Money Inserted:</span><span id="bdInserted">₱10.00</span>
      </div>
      <div class="row">
        <span>Pages Printed (2 of 3):</span><span id="bdCharged">₱6.00</span>
      </div>
      <div class="row highlight">
        <span>Unprinted Page Refund (1 page):</span
        ><span id="bdRefund">₱3.00</span>
      </div>
      <div class="row">
        <span>Original Change:</span><span id="bdChange">₱1.00</span>
      </div>
      <hr />
      <div class="row total">
        <span>Total Dispensed:</span><strong id="bdTotal">₱4.00</strong>
      </div>
    </div>
    <button class="btn btn-primary" id="btnCloseBreakdown">Done</button>
  </div>
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/modules/printer/printer.guard.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/public/confirm/index.html src/public/confirm/app.ts src/services/esp32.ts src/modules/printer/printer.guard.spec.ts
git commit -m "feat(ui): add itemized refund breakdown modal and hardware coin inhibit"
```

---

## Execution Handoff

Plan complete and saved to [`docs/superpowers/plans/2026-08-30-escrow-post-print-reconciliation.md`](file:///C:/Users/printbit/printbit/docs/superpowers/plans/2026-08-30-escrow-post-print-reconciliation.md).

Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach would you like to proceed with?**
