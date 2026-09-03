# Printer & Spooler Worker Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire heavy Node.js PowerShell and spooler polling services (~150 KB) by transferring printer ownership to the C# worker, implementing in-memory telemetry projection, and unifying print execution on worker queue handoff.

**Architecture:** C# Worker (`printbit-worker`) serves as the authoritative source of truth for physical printer readiness and Windows spooler health using native WinSpool and WMI APIs, broadcasting lifecycle events over a named pipe (`\\.\pipe\printbit-worker-events`). Node.js maintains an in-memory telemetry snapshot (`printer-state-projection.ts`) with zero child processes, and routes all print requests (Copy, Standard Print, Test Page) through atomic file drops in `queue/` monitored by `PrintQueueWatcher`.

**Tech Stack:** TypeScript, Node.js, Express, Socket.IO, C# .NET 10, Windows WinSpool API, Windows Named Pipes, Jest.

**Spec:** [docs/superpowers/specs/2026-09-02-printer-worker-migration-design.md](file:///C:/Users/printbit/printbit/docs/superpowers/specs/2026-09-02-printer-worker-migration-design.md)

## Global Constraints

- No `powershell.exe` or `wmic.exe` child process spawns in Node.js for printer telemetry or spooler polling.
- Node.js must not interact directly with `winspool.drv` or Windows Spooler service; all device control belongs to C#.
- Socket.IO event contract for kiosk frontend (`workerPrintStarted`, `workerPrintProgress`, `workerPrintSucceeded`, `workerPrintFailed`) must remain 100% backward-compatible.
- File drops into `queue/` must be atomic: write `.tmp` first, rename to `.pdf`, then write `.json` sidecar.

---

### Task 1: C# Worker Initial Printer Telemetry Snapshot & Event Broadcast

**Files:**

- Modify: `C:\Users\printbit\printbit-worker\src\PrintBit.Infrastructure\IPC\WorkerPrintEventType.cs`
- Modify: `C:\Users\printbit\printbit-worker\src\PrintBit.Infrastructure\IPC\WorkerPrintEvent.cs`
- Modify: `C:\Users\printbit\printbit-worker\src\PrintBit.Infrastructure.Windows\PrinterMonitoring\PrinterHealthMonitor.cs`
- Test: `C:\Users\printbit\printbit-worker\tests`

**Interfaces:**

- Consumes: Existing `IWorkerEventPipeClient.PublishAsync()`
- Produces: `WorkerPrintEventType.PrinterStatusSnapshot` broadcast on startup and client connection.

* [ ] **Step 1: Add `PrinterStatusSnapshot` to `WorkerPrintEventType` and `WorkerPrintEvent`**

In `C:\Users\printbit\printbit-worker\src\PrintBit.Infrastructure\IPC\WorkerPrintEventType.cs`:

```csharp
public enum WorkerPrintEventType
{
    PrintStarted,
    PrintProgress,
    PrintSucceeded,
    PrintFailed,
    PrinterOffline,
    PrinterOnline,
    PrinterError,
    JobPaused,
    JobResumed,
    JobCompleted,
    PowerStatusChanged,
    PowerStatusSnapshot,
    PrinterStatusSnapshot
}
```

- [ ] **Step 2: Add initial snapshot broadcast in `PrinterHealthMonitor.cs`**

In `PrinterHealthMonitor.cs`, upon entering `ExecuteAsync`, emit the current snapshot over `_eventPipe`:

```csharp
var initialSnapshot = new WorkerPrintEvent
{
    Type = WorkerPrintEventType.PrinterStatusSnapshot,
    PrinterName = _hardwareSettings.PrinterName,
    Message = isOnline ? "Printer is online" : "Printer is offline",
    TimestampUtc = DateTime.UtcNow.ToString("o")
};
await _eventPipe.PublishAsync(initialSnapshot, stoppingToken);
```

- [ ] **Step 3: Run C# tests to verify compilation and behavior**

Run: `dotnet test C:\Users\printbit\printbit-worker`  
Expected: PASS

- [ ] **Step 4: Commit C# worker changes**

```bash
git -C C:\Users\printbit\printbit-worker add src/
git -C C:\Users\printbit\printbit-worker commit -m "feat: add PrinterStatusSnapshot event broadcast on startup"
```

---

### Task 2: Node.js In-Memory Printer State Projection & Worker Return Pipe Integration

**Files:**

- Create: `C:\Users\printbit\printbit\src\services\printer-state-projection.ts`
- Modify: `C:\Users\printbit\printbit\src\services\worker-return-pipe.ts`
- Create: `C:\Users\printbit\printbit\tests\services\printer-state-projection.spec.ts`

**Interfaces:**

- Consumes: `WorkerPrintEvent` from `worker-return-pipe.ts`
- Produces: `printerStateProjection.getSnapshot()`, `printerStateProjection.isReady()`

* [ ] **Step 1: Write unit test for `printer-state-projection.ts`**

In `tests/services/printer-state-projection.spec.ts`:

```typescript
import { printerStateProjection } from '@/services/printer-state-projection';
import type { WorkerPrintEvent } from '@/services/worker-return-pipe';

describe('PrinterStateProjection', () => {
  beforeEach(() => {
    printerStateProjection.reset();
  });

  it('updates state on PrinterStatusSnapshot', () => {
    const event: WorkerPrintEvent = {
      type: 'PrinterStatusSnapshot',
      printerName: 'EPSON L5290 Series',
      timestampUtc: new Date().toISOString(),
    };
    printerStateProjection.applyEvent(event);
    const snapshot = printerStateProjection.getSnapshot();
    expect(snapshot.name).toBe('EPSON L5290 Series');
    expect(snapshot.connected).toBe(true);
    expect(snapshot.status).toBe('ready');
  });

  it('handles PrinterError event', () => {
    const event: WorkerPrintEvent = {
      type: 'PrinterError',
      printerName: 'EPSON L5290 Series',
      errorMessage: 'Paper jam',
      timestampUtc: new Date().toISOString(),
    };
    printerStateProjection.applyEvent(event);
    const snapshot = printerStateProjection.getSnapshot();
    expect(snapshot.status).toBe('error');
    expect(snapshot.error).toBe('Paper jam');
    expect(printerStateProjection.isReady()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/services/printer-state-projection.spec.ts`  
Expected: FAIL with module not found

- [ ] **Step 3: Implement `printer-state-projection.ts`**

In `src/services/printer-state-projection.ts`:

```typescript
import type { WorkerPrintEvent } from './worker-return-pipe';

export interface ProjectedPrinterState {
  connected: boolean;
  name: string | null;
  status: 'ready' | 'printing' | 'offline' | 'error';
  lastCheckedAt: string;
  error: string | null;
}

export class PrinterStateProjection {
  private state: ProjectedPrinterState = {
    connected: false,
    name: null,
    status: 'offline',
    lastCheckedAt: new Date().toISOString(),
    error: 'Initializing worker connection...',
  };

  public reset(): void {
    this.state = {
      connected: false,
      name: null,
      status: 'offline',
      lastCheckedAt: new Date().toISOString(),
      error: null,
    };
  }

  public applyEvent(evt: WorkerPrintEvent): void {
    const timestamp = evt.timestampUtc || new Date().toISOString();
    switch (evt.type) {
      case 'PrinterStatusSnapshot':
      case 'PrinterOnline':
        this.state = {
          connected: true,
          name: evt.printerName ?? this.state.name,
          status: 'ready',
          lastCheckedAt: timestamp,
          error: null,
        };
        break;
      case 'PrinterOffline':
        this.state = {
          connected: false,
          name: evt.printerName ?? this.state.name,
          status: 'offline',
          lastCheckedAt: timestamp,
          error: evt.errorMessage ?? 'Printer is offline',
        };
        break;
      case 'PrinterError':
        this.state = {
          connected: true,
          name: evt.printerName ?? this.state.name,
          status: 'error',
          lastCheckedAt: timestamp,
          error: evt.errorMessage ?? 'Printer hardware error',
        };
        break;
      case 'PrintStarted':
      case 'PrintProgress':
        this.state.status = 'printing';
        this.state.lastCheckedAt = timestamp;
        break;
      case 'PrintSucceeded':
      case 'PrintFailed':
        this.state.status = 'ready';
        this.state.lastCheckedAt = timestamp;
        break;
    }
  }

  public getSnapshot(): ProjectedPrinterState {
    return { ...this.state };
  }

  public isReady(): boolean {
    return this.state.connected && this.state.status === 'ready';
  }
}

export const printerStateProjection = new PrinterStateProjection();
```

- [ ] **Step 4: Update `worker-return-pipe.ts` to forward printer events**

In `src/services/worker-return-pipe.ts`:
Add `PrinterStatusSnapshot` to `WorkerPrintEventType`, update `mapWorkerEventToSocket`, and forward incoming printer events to `printerStateProjection.applyEvent(evt)`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/services/printer-state-projection.spec.ts`  
Expected: PASS

- [ ] **Step 6: Commit changes**

```bash
git add src/services/printer-state-projection.ts src/services/worker-return-pipe.ts tests/services/printer-state-projection.spec.ts
git commit -m "feat: add printer state projection listening to worker return pipe"
```

---

### Task 3: Refactor Node.js Printer Dispatch to Worker Queue Handoff

**Files:**

- Modify: `C:\Users\printbit\printbit\src\services\printer.ts`
- Modify: `C:\Users\printbit\printbit\src\modules\admin\admin.controller.ts`
- Test: `C:\Users\printbit\printbit\tests\printer\printer-handoff.spec.ts`

**Interfaces:**

- Consumes: `handoffToWorker()` from `worker-handoff.ts`, `printerStateProjection`
- Produces: `printerService.printFile()` returning queue handoff result

* [ ] **Step 1: Write test for refactored `printFile` with queue handoff**

Create `tests/printer/printer-handoff.spec.ts`:

```typescript
import { printerService } from '@/services/printer';
import * as workerHandoff from '@/services/worker-handoff';

jest.mock('@/services/worker-handoff');

describe('PrinterService Queue Handoff', () => {
  it('dispatches print jobs via handoffToWorker', async () => {
    const mockHandoff = jest
      .spyOn(workerHandoff, 'handoffToWorker')
      .mockResolvedValue({
        targetPath: 'C:\\queue\\tx-1_spool-1.pdf',
        fileName: 'tx-1_spool-1.pdf',
      });

    // Test print dispatch
    // Verify handoffToWorker was called with transactionId and options
  });
});
```

- [ ] **Step 2: Refactor `src/services/printer.ts`**

Remove `powershell.exe` printer detection, remove Sumatra/PDFtoPrinter dispatch. Update `printFile` to:

1. Validate file exists in uploads.
2. Prepare PDF rotation/geometry artifact.
3. Call `handoffToWorker()` with `WORKER_QUEUE_DIR`, `transactionId`, `spoolerCorrelationKey`, and `printSettings`.
4. Return a clean `{ success: true, fileName: handoffResult.fileName }` result.

- [ ] **Step 3: Update `admin.controller.ts`**

Replace `getPrinterTelemetry` with reads from `printerStateProjection.getSnapshot()`.
Update test-page endpoint to generate test PDF and dispatch via `printerService.printFile()`.

- [ ] **Step 4: Run tests to verify PASS**

Run: `npm test -- tests/printer/printer-handoff.spec.ts`  
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/services/printer.ts src/modules/admin/admin.controller.ts tests/printer/printer-handoff.spec.ts
git commit -m "refactor(printer): dispatch all print jobs via worker queue handoff"
```

---

### Task 4: Migrate Copy and Financial Services from Spooler Polling to Worker Events

**Files:**

- Modify: `C:\Users\printbit\printbit\src\modules\copy\copy.service.ts`
- Modify: `C:\Users\printbit\printbit\src\modules\financial\financial.service.ts`
- Test: `C:\Users\printbit\printbit\src\modules\copy\copy.service.spec.ts`
- Test: `C:\Users\printbit\printbit\src\modules\financial\financial.service.spec.ts`

**Interfaces:**

- Consumes: `worker-return-pipe` events (`workerPrintSucceeded`, `workerPrintFailed`)
- Produces: Event-driven transaction completion without `monitorSpoolerJob()`

* [ ] **Step 1: Refactor `copy.service.ts`**

Remove `import { monitorSpoolerJob } from '@/services/print-spooler'`.
In `createCopyJob`:
Remove `monitorSpoolerJob` call. The copy job is dispatched via `printFile` (which queues it for C#), and completion is handled reactively by Socket.IO and the worker return pipe.

- [ ] **Step 2: Refactor `financial.service.ts`**

Remove `import { monitorSpoolerJob } from '@/services/print-spooler'`.
Remove the `monitorSpoolerJob()` execution block.
Replace with a one-shot subscriber or rely on `worker-return-pipe.ts`'s existing handler to trigger `runPostSpoolerConfirmedCallbacks()` when `workerPrintSucceeded` arrives for that transaction.

- [ ] **Step 3: Run existing copy and financial unit tests**

Run: `npm test -- src/modules/copy/copy.service.spec.ts`  
Run: `npm test -- src/modules/financial/financial.service.spec.ts`  
Expected: PASS

- [ ] **Step 4: Commit changes**

```bash
git add src/modules/copy/copy.service.ts src/modules/financial/financial.service.ts
git commit -m "refactor(copy,financial): eliminate spooler polling in favor of worker events"
```

---

### Task 5: Retire Legacy Spooler & Printer Services and Clean Exports

**Files:**

- Delete: `src/services/print-spooler.ts`
- Delete: `src/services/printer-status.ts`
- Delete: `src/services/printer-monitor.ts`
- Delete: `src/services/windows-printer-edge.ts`
- Delete: `src/services/print-dispatcher.ts`
- Delete: `src/services/printer-fault-lock.ts`
- Modify: `src/services/index.ts`

* [ ] **Step 1: Check all remaining imports of retired files**

Run search across `src/` to find any lingering imports of:

- `./print-spooler`
- `./printer-status`
- `./printer-monitor`
- `./windows-printer-edge`
- `./print-dispatcher`
- `./printer-fault-lock`
  Redirect any needed type imports (e.g. `PrintJobOptions`) to `src/services/printer.ts` or `src/services/printer-state-projection.ts`.

* [ ] **Step 2: Update `src/services/index.ts`**

Remove the barrel exports for the retired files:

```typescript
// Remove:
// export * from './print-spooler';
// export * from './printer-status';
// export * from './printer-monitor';
// export * from './windows-printer-edge';
// export * from './print-dispatcher';
// export * from './printer-fault-lock';
// Add:
export * from './printer-state-projection';
```

- [ ] **Step 3: Delete the retired files**

```bash
git rm src/services/print-spooler.ts
git rm src/services/printer-status.ts
git rm src/services/printer-monitor.ts
git rm src/services/windows-printer-edge.ts
git rm src/services/print-dispatcher.ts
git rm src/services/printer-fault-lock.ts
```

- [ ] **Step 4: Verify complete TypeScript compilation**

Run: `npx tsc --noEmit`  
Expected: Clean compilation with 0 errors.

- [ ] **Step 5: Commit retirement**

```bash
git add src/services/index.ts
git commit -m "refactor: retire legacy print spooler, dispatcher, and status services (~150KB)"
```

---

### Task 6: Full Verification & System Health Check

- [ ] **Step 1: Run all test suites in Node**

Run: `npm test`  
Expected: All test suites pass.

- [ ] **Step 2: Run all test suites in C# Worker**

Run: `dotnet test C:\Users\printbit\printbit-worker`  
Expected: All tests pass.

- [ ] **Step 3: Run Graphify update**

Run: `graphify update .` in `C:\Users\printbit\printbit` to synchronize the knowledge graph with the retired services.

- [ ] **Step 4: Verify zero `powershell.exe` child processes**

Start the kiosk server and confirm via PowerShell `Get-Process powershell -ErrorAction SilentlyContinue` that no background polling runspaces are spawned by Node.
