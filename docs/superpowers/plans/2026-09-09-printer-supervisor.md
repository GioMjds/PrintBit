# Printer Supervisor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a privileged C# printer supervisor that detects and repairs recoverable Spooler failures while Node fails closed for printing, copying, payment initiation, and coin acceptance.

**Architecture:** The sibling `../printbit-worker` repository owns health sampling, recovery, circuit breaking, job progress, and authoritative snapshots. This `printbit` repository consumes those snapshots, persists audits, enforces server-side and coin-slot gates, and exposes authenticated administrator controls through the existing named pipes.

**Tech Stack:** .NET 10 Windows Worker Service, C#, ServiceController, WMI/WinSpool, xUnit/Moq, Node.js 22+, TypeScript, Express 5, Socket.IO, Jest, PowerShell.

**Spec:** `docs/superpowers/specs/2026-09-09-printer-supervisor-design.md`

## Global Constraints

- Preserve `DocumentPrinter`'s `SemaphoreSlim(1, 1)` and the 120-second Sumatra timeout.
- Printing and recovery share the singleton `IPrinterOperationCoordinator` lease.
- Physical faults never trigger Spooler start/restart.
- No recovery path purges arbitrary jobs or deletes `.spl`/`.shd` files.
- Existing cleanup may cancel only the correlated failed PrintBit job.
- Poll every 5 seconds; confirm Windows-side failure and restored health with 2 samples.
- Open the circuit after 3 failed automatic recoveries in a rolling 10-minute window.
- Node snapshots become stale 15 seconds after local receipt.
- Stuck timeout is `60 + 30 * selectedPages` seconds, capped at 15 minutes.
- Discover the current port from the exact configured printer name; never require `USB004`.
- Preserve administrator/System-only pipe ACLs and other coin-slot lock owners.
- Preserve the existing dirty `../printbit-worker/README.md`; every commit is path-limited.
- Update `../printbit-worker/AGENTS.md` when its contracts, DI, settings, or tests change.
- Run `graphify update .` after changing code in `printbit`.

---

## Execution Order

Execute Tasks 1-5 in `../printbit-worker` first, then Tasks 6-10 in `printbit`. The Node tasks are listed before the Worker task details only because the plan was assembled in two repository-focused sections; task numbers, dependencies, and commits remain authoritative.

### Task 6: Node snapshot projection, epochs, and staleness

**Repository:** current `printbit`

**Files:**
- Modify: `src/services/worker-return-pipe.ts`
- Modify: `src/services/printer-state-projection.ts`
- Modify: `src/server.ts`
- Modify: `tests/services/printer-state-projection.spec.ts`
- Modify: `tests/services/worker-return-pipe.spec.ts`
- Create: `tests/services/printer-supervisor-staleness.spec.ts`

**Interfaces:**
- Consumes: Worker `PrinterSupervisorSnapshot` JSON.
- Produces: typed snapshots, connection epochs, ordered application, and `isFreshReady`.

- [ ] **Step 1: Write failing projection tests**

```typescript
test('starts fail closed', () => expect(projection.isFreshReady(0)).toBe(false));
test('rejects sequence 3 after sequence 4 in one epoch', () => {
  projection.beginWorkerEpoch('one');
  expect(projection.applySupervisorSnapshot(snapshot(4, 'ready'), 1_000)).toBe(true);
  expect(projection.applySupervisorSnapshot(snapshot(3, 'maintenance'), 1_001)).toBe(false);
});
test('accepts sequence reset in a new epoch', () => {
  projection.beginWorkerEpoch('two');
  expect(projection.applySupervisorSnapshot(snapshot(1, 'ready'), 2_000)).toBe(true);
});
test('expires at fifteen seconds local time', () => {
  expect(projection.isFreshReady(16_999)).toBe(true);
  expect(projection.isFreshReady(17_000)).toBe(false);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm test -- --runInBand tests/services/printer-state-projection.spec.ts tests/services/worker-return-pipe.spec.ts tests/services/printer-supervisor-staleness.spec.ts`

Expected: new APIs and event type are absent.

- [ ] **Step 3: Add exact wire types and projection**

```typescript
export type PrinterSupervisorStatus = 'ready' | 'busy' | 'recovering' | 'maintenance';
export interface PrinterSupervisorSnapshot {
  type: 'PrinterSupervisorSnapshot'; sequence: number; timestampUtc: string;
  status: PrinterSupervisorStatus;
  spooler: { status: string; responsive: boolean };
  queue: { status: string; activeJobId: string | null };
  printer: { name: string; portName: string | null; connected: boolean; issueKind: string; message: string | null };
  recovery: { attemptsInWindow: number; circuitOpen: boolean; lastAction: string | null };
}
```

Set `PRINTER_SUPERVISOR_STALE_MS = 15_000`. Store local monotonic receipt time. Start a new epoch for each pipe connection and reject non-increasing sequences within it. Emit the existing malfunction/recovered/status Socket.IO events from accepted transitions.

- [ ] **Step 4: Run tests, lint, build, update graph, and commit**

```powershell
pnpm test -- --runInBand tests/services/printer-state-projection.spec.ts tests/services/worker-return-pipe.spec.ts tests/services/printer-supervisor-staleness.spec.ts
pnpm exec eslint src/services/worker-return-pipe.ts src/services/printer-state-projection.ts src/server.ts
pnpm run build
graphify update .
git add -- src/services/worker-return-pipe.ts src/services/printer-state-projection.ts src/server.ts tests/services/printer-state-projection.spec.ts tests/services/worker-return-pipe.spec.ts tests/services/printer-supervisor-staleness.spec.ts graphify-out
git commit -m "feat: project printer supervisor health"
```

---

### Task 7: Coin lock and paid-operation gates

**Repository:** current `printbit`

**Files:**
- Create: `src/services/printer-readiness-gate.ts`
- Modify: `src/services/hardware-state-projection.ts`
- Modify: `src/services/printer.ts`
- Modify: `src/modules/printer/printer.service.ts`
- Modify: `src/modules/copy/copy.service.ts`
- Modify: `src/modules/financial/financial.service.ts`
- Modify: `src/modules/printer/printer.controller.ts`
- Modify: `src/guards/printer-guard.ts`
- Create: `tests/services/printer-readiness-gate.spec.ts`
- Modify: `src/services/__tests__/hardware-state-projection.test.ts`
- Modify: `src/modules/printer/printer.service.spec.ts`
- Create: `tests/modules/printer-supervisor-payment-gate.spec.ts`

**Interfaces:**
- Consumes: Task 6 `isFreshReady` and existing coin-slot commands.
- Produces: one reusable server predicate and an owner-safe `printer-supervisor` lock.

- [ ] **Step 1: Write failing gate tests**

```typescript
test.each(['print', 'copy', 'payment', 'handoff'] as const)(
  'rejects %s before a fresh ready snapshot',
  (operation) => expect(() => assertPrinterReady(operation, 0))
    .toThrow('Printer subsystem is not ready'),
);
test('stale state locks with printer-supervisor owner', async () => {
  await synchronizePrinterCoinLock(16_000);
  expect(sendWorkerCommand).toHaveBeenCalledWith(expect.objectContaining({
    type: 'LockCoinSlot', ownerId: 'printer-supervisor',
  }));
});
```

Also prove returning ready releases only `printer-supervisor` and leaves `power-safety` locked.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm test -- --runInBand tests/services/printer-readiness-gate.spec.ts src/services/__tests__/hardware-state-projection.test.ts src/modules/printer/printer.service.spec.ts tests/modules/printer-supervisor-payment-gate.spec.ts`

Expected: failure because the shared gate is absent.

- [ ] **Step 3: Implement the shared predicate and lock synchronizer**

```typescript
export type PrinterOperation = 'print' | 'copy' | 'payment' | 'handoff';
export class PrinterReadinessError extends Error {
  readonly code = 'PRINTER_SUPERVISOR_NOT_READY';
  constructor(readonly operation: PrinterOperation) {
    super('Printer subsystem is not ready');
  }
}
export function assertPrinterReady(operation: PrinterOperation, nowMs = performance.now()): void;
```

Synchronize on accepted snapshots, Worker disconnect, and a five-second stale timer. Await lock transitions; a command failure stays logically blocked and produces an admin warning. Never call `resetCoinSlotLocks`.

- [ ] **Step 4: Enforce every server boundary**

Call the predicate before successful preflight, standard handoff, copy payment/dispatch, `confirmPayment` immediately before balance/recovery mutation, and again immediately before `handoffToWorker`. Map the typed error to HTTP 503. Do not gate terminal settlement/refund for an already admitted job.

- [ ] **Step 5: Keep browser behavior presentation-only**

Update the guard to display all four public states while obeying server-provided `blocked`. Startup and fetch failures stay blocked.

- [ ] **Step 6: Run verification, update graph, and commit**

```powershell
pnpm test -- --runInBand tests/services/printer-readiness-gate.spec.ts src/services/__tests__/hardware-state-projection.test.ts src/modules/printer/printer.service.spec.ts tests/modules/printer-supervisor-payment-gate.spec.ts tests/services/worker-print-lifecycle.spec.ts tests/printer/printer-handoff.spec.ts
pnpm exec eslint src/services/printer-readiness-gate.ts src/services/hardware-state-projection.ts src/services/printer.ts src/modules/printer/printer.service.ts src/modules/copy/copy.service.ts src/modules/financial/financial.service.ts src/modules/printer/printer.controller.ts src/guards/printer-guard.ts
pnpm run build
graphify update .
git add -- src/services/printer-readiness-gate.ts src/services/hardware-state-projection.ts src/services/printer.ts src/modules/printer/printer.service.ts src/modules/copy/copy.service.ts src/modules/financial/financial.service.ts src/modules/printer/printer.controller.ts src/guards/printer-guard.ts tests/services/printer-readiness-gate.spec.ts src/services/__tests__/hardware-state-projection.test.ts src/modules/printer/printer.service.spec.ts tests/modules/printer-supervisor-payment-gate.spec.ts graphify-out
git commit -m "fix: fail closed on printer health"
```

---

### Task 8: Durable audit and administrator recovery controls

**Repository:** current `printbit`

**Files:**
- Modify: `src/services/worker-command-pipe.ts`
- Create: `src/services/printer-supervisor-audit.ts`
- Modify: `src/core/database/db.ts`
- Modify: `src/modules/admin/admin.controller.ts`
- Modify: `src/public/admin/system/index.html`
- Modify: `src/public/admin/system/app.ts`
- Modify: `src/public/admin/system/styles.css`
- Create: `tests/services/printer-supervisor-audit.spec.ts`
- Create: `tests/modules/admin-printer-recovery.spec.ts`
- Create: `tests/public/admin-printer-recovery-ui.spec.ts`

**Interfaces:**
- Consumes: Task 6 projection and Worker recovery commands.
- Produces: 45-second typed requests, bounded history, authenticated endpoints, and admin UI.

- [ ] **Step 1: Write failing command/audit/API/UI tests**

Assert `PRINTER_RECOVERY_RESPONSE_TIMEOUT_MS >= 45_000`; unauthenticated requests fail; status is read-only; retry preserves `requestId`; concurrent retry returns 409; each result is audited. DOM tests require Spooler, queue, port, attempt count, circuit state, last action, and a disabled-while-running Retry button.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm test -- --runInBand tests/services/printer-supervisor-audit.spec.ts tests/modules/admin-printer-recovery.spec.ts tests/public/admin-printer-recovery-ui.spec.ts`

Expected: command types, audit store, routes, and UI are absent.

- [ ] **Step 3: Add command types and bounded audit**

Add `GetPrinterRecoveryStatus` and `AttemptPrinterRecovery`, a typed response, and `PRINTER_RECOVERY_RESPONSE_TIMEOUT_MS = 45_000`. Transport/malformed failures never map to healthy. Store at most 500 `PrinterSupervisorAuditEntry` rows; deduplicate unchanged heartbeats but retain all recovery and transport events.

- [ ] **Step 4: Add authenticated endpoints**

```text
GET  /api/admin/printer/recovery-status
POST /api/admin/printer/retry-recovery
GET  /api/admin/printer/recovery-history?limit=50
```

Use an in-process promise guard for retry; a second request returns 409. Append both the existing admin log and structured supervisor audit.

- [ ] **Step 5: Add the administrator panel**

Render the required fields. Show Retry only for maintenance, disable it during the request, present the returned message, and refresh status/history. Do not expose queue purge.

- [ ] **Step 6: Run verification, update graph, and commit**

```powershell
pnpm test -- --runInBand tests/services/printer-supervisor-audit.spec.ts tests/modules/admin-printer-recovery.spec.ts tests/public/admin-printer-recovery-ui.spec.ts tests/modules/admin-test-print.spec.ts
pnpm exec eslint src/services/worker-command-pipe.ts src/services/printer-supervisor-audit.ts src/core/database/db.ts src/modules/admin/admin.controller.ts src/public/admin/system/app.ts
pnpm run build
graphify update .
git add -- src/services/worker-command-pipe.ts src/services/printer-supervisor-audit.ts src/core/database/db.ts src/modules/admin/admin.controller.ts src/public/admin/system/index.html src/public/admin/system/app.ts src/public/admin/system/styles.css tests/services/printer-supervisor-audit.spec.ts tests/modules/admin-printer-recovery.spec.ts tests/public/admin-printer-recovery-ui.spec.ts graphify-out
git commit -m "feat: add printer recovery controls"
```

---

### Task 9: USB selective-suspend deployment hardening

**Repository:** current `printbit`

**Files:**
- Create: `scripts/configure-printer-usb-power.ps1`
- Create: `scripts/verify-printer-usb-power.ps1`
- Modify: `package.json`
- Modify: `INSTALLATIONS.md`
- Create: `tests/scripts/printer-usb-power.spec.ts`

**Interfaces:**
- Consumes: Windows `powercfg` active scheme.
- Produces: idempotent apply/verify scripts without per-device registry mutation.

- [ ] **Step 1: Write failing script-contract tests**

Assert both scripts resolve `/GETACTIVESCHEME`; apply sets AC/DC values to zero for USB subgroup `2a737441-1930-4402-8d77-b2bebba308a3` and selective-suspend setting `48e6b7a6-50f5-4782-a5d4-53bb8f07e226`; apply supports `-WhatIf`; neither script contains `Set-ItemProperty`, `reg.exe`, `Disable-PnpDevice`, or `Remove-PnpDevice`.

- [ ] **Step 2: Run test and verify RED**

Run: `pnpm test -- --runInBand tests/scripts/printer-usb-power.spec.ts`

Expected: scripts are absent.

- [ ] **Step 3: Implement scripts and package wiring**

Apply these exact settings and validate each exit code:

```text
/SETACVALUEINDEX $schemeGuid $usbSubgroupGuid $selectiveSuspendGuid 0
/SETDCVALUEINDEX $schemeGuid $usbSubgroupGuid $selectiveSuspendGuid 0
```

Reactivate the same scheme. Verification uses `/QUERY` and exits nonzero unless both indices are `0x00000000`. Add `usb-power:apply` and `usb-power:verify`; include apply in `install-kiosk`. Document the separate Device Manager hub checkbox.

- [ ] **Step 4: Verify without changing this host, update graph, and commit**

```powershell
pnpm test -- --runInBand tests/scripts/printer-usb-power.spec.ts
pwsh -NoProfile -Command "[void][scriptblock]::Create((Get-Content -Raw './scripts/configure-printer-usb-power.ps1')); [void][scriptblock]::Create((Get-Content -Raw './scripts/verify-printer-usb-power.ps1'))"
pnpm run build
graphify update .
git add -- scripts/configure-printer-usb-power.ps1 scripts/verify-printer-usb-power.ps1 package.json INSTALLATIONS.md tests/scripts/printer-usb-power.spec.ts graphify-out
git commit -m "feat: harden printer usb power settings"
```

---

### Task 10: Cross-repository contract and completion verification

**Repositories:** current `printbit` and `../printbit-worker`

**Files:**
- Create: `scripts/verify-printer-supervisor-contract.js`
- Modify: `package.json`
- Create: `tests/services/printer-supervisor-contract.spec.ts`
- Modify only if implementation corrected the contract: `docs/superpowers/specs/2026-09-09-printer-supervisor-design.md`
- Modify only if final behavior changed: `../printbit-worker/AGENTS.md`

**Interfaces:**
- Consumes: Tasks 1-9.
- Produces: executable C#/TypeScript schema compatibility and final repository evidence.

- [ ] **Step 1: Write failing fixture verification**

Make the Worker contract test emit `printer-supervisor-snapshot.json` into its test output. The Node test invokes the verifier and proves it rejects missing `sequence`, unknown status, and nonnumeric `attemptsInWindow`.

- [ ] **Step 2: Run and verify RED**

```powershell
dotnet test ../printbit-worker/tests/PrintBit.Tests/PrintBit.Tests.csproj --no-restore --filter FullyQualifiedName~PrinterSupervisorContractsTests
node scripts/verify-printer-supervisor-contract.js ../printbit-worker/tests/PrintBit.Tests/bin/Debug/net10.0-windows/printer-supervisor-snapshot.json
```

Expected: Node verifier is absent.

- [ ] **Step 3: Implement zero-dependency verifier**

Use `node:fs` and explicit type guards for every required field, enum, nested object, and nullability rule. Print one success line; print field-specific failures and exit 1. Add `printer-supervisor:verify-contract` to `package.json`.

- [ ] **Step 4: Run complete verification**

```powershell
dotnet test ../printbit-worker/printbit-worker.slnx --no-restore
dotnet build ../printbit-worker/printbit-worker.slnx --no-restore
pnpm test -- --runInBand
pnpm run lint
pnpm run build
pnpm run printer-supervisor:verify-contract
graphify update .
git diff --check
git -C ../printbit-worker diff --check
```

Expected: zero failures and errors; resolve every new warning.

- [ ] **Step 5: Prove destructive recovery is absent**

Run: `rg -n "spool\\PRINTERS|\.spl|\.shd|Remove-Item|Delete.*PrintJob|Purge" src scripts ../printbit-worker/src`

Expected: no blanket purge path; existing correlated `CancelMatchingJobs` stays scoped by printer/document/job ID.

- [ ] **Step 6: Commit verification slice**

```powershell
git add -- scripts/verify-printer-supervisor-contract.js package.json tests/services/printer-supervisor-contract.spec.ts graphify-out docs/superpowers/specs/2026-09-09-printer-supervisor-design.md
git commit -m "test: verify printer supervisor contract"
```

- [ ] **Step 7: Record target-tablet evidence**

On the kiosk tablet, record timestamped results for stopped Spooler, USB disconnect, paper-out, stalled correlated job, Worker disconnect/staleness, three recovery failures, administrator half-open retry, healthy restoration, and `pnpm run usb-power:verify`. Do not claim physical validation before those results exist.

---

### Task 1: Worker contracts and validated settings

**Repository:** `../printbit-worker`

**Files:**
- Create: `src/PrintBit.Infrastructure/Services/PrintService/PrinterSupervisorContracts.cs`
- Create: `src/PrintBit.Infrastructure/Services/PrintService/IPrinterSupervisor.cs`
- Modify: `src/PrintBit.Shared/Configurations/PrinterRecoverySettings.cs`
- Modify: `src/PrintBit.Infrastructure/IPC/WorkerPrintEventType.cs`
- Modify: `src/PrintBit.Infrastructure/IPC/IWorkerEventPipeClient.cs`
- Test: `tests/PrintBit.Tests/PrinterSupervisorContractsTests.cs`

**Interfaces:**
- Consumes: existing printer health enums and Worker event JSON conventions.
- Produces: supervisor state/snapshot types and `IPrinterSupervisor` for Tasks 3-5.

- [ ] **Step 1: Write failing contract tests**

```csharp
[Fact]
public void Snapshot_SerializesStableCamelCaseContract()
{
    var value = PrinterSupervisorSnapshot.Ready(
        7,
        DateTime.Parse("2026-09-09T06:26:12Z").ToUniversalTime(),
        "EPSON L5290 Series",
        "USB005");
    var json = JsonSerializer.Serialize(value, WorkerJson.Options);
    Assert.Contains("\"status\":\"ready\"", json);
    Assert.Contains("\"sequence\":7", json);
    Assert.Contains("\"portName\":\"USB005\"", json);
}

[Fact]
public void Settings_DefaultsMatchApprovedPolicy()
{
    var value = new PrinterRecoverySettings();
    Assert.Equal((5, 2, 2), (value.SupervisorPollIntervalSeconds,
        value.UnhealthySamplesBeforeRecovery, value.HealthySamplesBeforeReady));
    Assert.Equal((3, 10), (value.CircuitBreakerFailureLimit,
        value.CircuitBreakerWindowMinutes));
    Assert.Equal((60, 30, 15), (value.StuckBaseTimeoutSeconds,
        value.StuckPerPageTimeoutSeconds, value.StuckTimeoutCapMinutes));
}
```

- [ ] **Step 2: Run tests and verify RED**

Run: `dotnet test ../printbit-worker/tests/PrintBit.Tests/PrintBit.Tests.csproj --no-restore --filter FullyQualifiedName~PrinterSupervisorContractsTests`

Expected: compilation fails because the contracts and settings are absent.

- [ ] **Step 3: Implement exact public contracts**

```csharp
public enum PrinterSupervisorState { Starting, Ready, Busy, Recovering, Maintenance, CircuitOpen }
public enum PrinterSupervisorPublicStatus { Ready, Busy, Recovering, Maintenance }
public sealed record SupervisorSpoolerSnapshot(string Status, bool Responsive);
public sealed record SupervisorQueueSnapshot(string Status, string? ActiveJobId);
public sealed record SupervisorPrinterSnapshot(string Name, string? PortName,
    bool Connected, string IssueKind, string? Message);
public sealed record SupervisorRecoverySnapshot(int AttemptsInWindow,
    bool CircuitOpen, string? LastAction);
public sealed record PrinterSupervisorSnapshot(WorkerPrintEventType Type,
    long Sequence, DateTime TimestampUtc,
    PrinterSupervisorPublicStatus Status, SupervisorSpoolerSnapshot Spooler,
    SupervisorQueueSnapshot Queue, SupervisorPrinterSnapshot Printer,
    SupervisorRecoverySnapshot Recovery);

public interface IPrinterSupervisor
{
    PrinterSupervisorSnapshot CurrentSnapshot { get; }
    bool IsReady { get; }
    Task<PrinterRecoveryResult> AttemptManualRecoveryAsync(CancellationToken cancellationToken = default);
}
```

Add the static factory `PrinterSupervisorSnapshot.Ready(long sequence, DateTime timestampUtc, string printerName, string? portName)` used by the test. Add `PrinterSupervisorSnapshot` to `WorkerPrintEventType`. Extend `IWorkerEventPipeClient` with `PublishSupervisorAsync(PrinterSupervisorSnapshot, CancellationToken)` so the snapshot is serialized as the top-level JSON object shown in the spec, not nested inside `WorkerPrintEvent`. Add the approved settings plus `SupervisorEnabled`; expose `IsValidSupervisorPolicy()` requiring positive limits/timings.

- [ ] **Step 4: Run focused and full tests**

Run:

```powershell
dotnet test ../printbit-worker/tests/PrintBit.Tests/PrintBit.Tests.csproj --no-restore --filter FullyQualifiedName~PrinterSupervisorContractsTests
dotnet test ../printbit-worker/printbit-worker.slnx --no-restore
```

Expected: all pass.

- [ ] **Step 5: Commit Task 1**

```powershell
git -C ../printbit-worker add -- src/PrintBit.Infrastructure/Services/PrintService/PrinterSupervisorContracts.cs src/PrintBit.Infrastructure/Services/PrintService/IPrinterSupervisor.cs src/PrintBit.Shared/Configurations/PrinterRecoverySettings.cs src/PrintBit.Infrastructure/IPC/WorkerPrintEventType.cs src/PrintBit.Infrastructure/IPC/IWorkerEventPipeClient.cs tests/PrintBit.Tests/PrinterSupervisorContractsTests.cs
git -C ../printbit-worker commit -m "feat: define printer supervisor contract"
```

---

### Task 2: Worker health sources and operation visibility

**Repository:** `../printbit-worker`

**Files:**
- Modify: `src/PrintBit.Infrastructure/Services/PrintService/PrinterHealthDiagnostic.cs`
- Modify: `src/PrintBit.Infrastructure.Windows/PrinterMonitoring/PrinterHealthMonitor.cs`
- Modify: `src/PrintBit.Infrastructure.Windows/PrinterMonitoring/IPrintSpoolerController.cs`
- Modify: `src/PrintBit.Infrastructure.Windows/PrinterMonitoring/ServiceControllerSpoolerController.cs`
- Modify: `src/PrintBit.Infrastructure/Services/PrintService/IPrinterOperationCoordinator.cs`
- Modify: `src/PrintBit.Infrastructure/Services/PrintService/PrintOperationCoordinator.cs`
- Test: `tests/PrintBit.Tests/PrinterHealthMonitorTests.cs`
- Test: `tests/PrintBit.Tests/PrinterRecoveryServiceTests.cs`
- Create: `tests/PrintBit.Tests/PrinterOperationCoordinatorTests.cs`

**Interfaces:**
- Consumes: Task 1 settings.
- Produces: `PrinterHealthDiagnostic.PortName`, `IPrintSpoolerController.StartAsync`, and `IPrinterOperationCoordinator.ActiveOperation`.

- [ ] **Step 1: Write failing tests**

```csharp
[Fact]
public void ExactQueueDiagnostic_ReportsCurrentPort()
{
    var monitor = new DiagnosticPrinterHealthMonitor { WmiPortName = "USB005" };
    Assert.Equal("USB005", monitor.GetDiagnostic("EPSON L5290 Series").PortName);
}

[Fact]
public async Task Coordinator_ReportsPrintOnlyWhileLeaseHeld()
{
    using var value = new PrintOperationCoordinator();
    Assert.Equal(PrinterOperationKind.None, value.ActiveOperation);
    using (await value.AcquirePrintAsync(CancellationToken.None))
        Assert.Equal(PrinterOperationKind.Print, value.ActiveOperation);
    Assert.Equal(PrinterOperationKind.None, value.ActiveOperation);
}
```

Also assert a stopped Spooler repair calls `StartAsync` once and `RestartAsync` never.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `dotnet test ../printbit-worker/tests/PrintBit.Tests/PrintBit.Tests.csproj --no-restore --filter "FullyQualifiedName~PrinterHealthMonitorTests|FullyQualifiedName~PrinterRecoveryServiceTests|FullyQualifiedName~PrinterOperationCoordinatorTests"`

Expected: compilation fails on the three new interfaces/properties.

- [ ] **Step 3: Implement port and start-only probes**

Read `PortName` from the exact-name `Win32_Printer` record and return null when unavailable without changing an otherwise healthy classification. Add `StartAsync`; return success if already running, otherwise call `Start()` and poll every 200 ms up to `SpoolerTransitionTimeoutSeconds`. Never stop the service from `StartAsync`.

- [ ] **Step 4: Implement operation visibility**

```csharp
public enum PrinterOperationKind { None, Print, Recovery }
PrinterOperationKind ActiveOperation { get; }
```

Set the kind only after acquiring the semaphore. Reset it exactly once from the dispose-safe lease. `AcquirePrintAsync` uses `Print`; `TryAcquireRecovery` uses `Recovery`.

- [ ] **Step 5: Run focused/full tests and commit**

Run the Step 2 command and `dotnet test ../printbit-worker/printbit-worker.slnx --no-restore`, then:

```powershell
git -C ../printbit-worker add -- src/PrintBit.Infrastructure/Services/PrintService/PrinterHealthDiagnostic.cs src/PrintBit.Infrastructure.Windows/PrinterMonitoring/PrinterHealthMonitor.cs src/PrintBit.Infrastructure.Windows/PrinterMonitoring/IPrintSpoolerController.cs src/PrintBit.Infrastructure.Windows/PrinterMonitoring/ServiceControllerSpoolerController.cs src/PrintBit.Infrastructure/Services/PrintService/IPrinterOperationCoordinator.cs src/PrintBit.Infrastructure/Services/PrintService/PrintOperationCoordinator.cs tests/PrintBit.Tests/PrinterHealthMonitorTests.cs tests/PrintBit.Tests/PrinterRecoveryServiceTests.cs tests/PrintBit.Tests/PrinterOperationCoordinatorTests.cs
git -C ../printbit-worker commit -m "feat: expose printer supervisor health sources"
```

---

### Task 3: Supervisor state machine and circuit breaker

**Repository:** `../printbit-worker`

**Files:**
- Create: `src/PrintBit.Infrastructure.Windows/PrinterMonitoring/PrinterSupervisorStateMachine.cs`
- Create: `src/PrintBit.Infrastructure/Services/PrintService/ISystemClock.cs`
- Test: `tests/PrintBit.Tests/PrinterSupervisorStateMachineTests.cs`

**Interfaces:**
- Consumes: Tasks 1-2 contracts and typed diagnostics.
- Produces: deterministic transitions used by the hosted service.

- [ ] **Step 1: Write failing tests for every transition**

Create tests named `TwoWindowsFailures_RequestAutomaticRecovery`, `PhysicalFault_ImmediatelyEntersMaintenanceWithoutRecovery`, `RecoveryIsDeferredWhilePrintIsActive`, `TwoHealthySamples_ReturnToReady`, `ThreeFailuresWithinTenMinutes_OpenCircuit`, `OldFailures_ArePruned`, `SuccessfulHalfOpen_ClosesCircuit`, and `FailedHalfOpen_KeepsCircuitOpen`. Use a mutable fake implementing `ISystemClock { DateTime UtcNow { get; } }`.

- [ ] **Step 2: Run tests and verify RED**

Run: `dotnet test ../printbit-worker/tests/PrintBit.Tests/PrintBit.Tests.csproj --no-restore --filter FullyQualifiedName~PrinterSupervisorStateMachineTests`

Expected: compilation fails because the state machine is absent.

- [ ] **Step 3: Implement a pure decision engine**

```csharp
public enum SupervisorDecision { None, StartSpooler, RestartSpooler }
public sealed record SupervisorObservation(SpoolerStatusSnapshot Spooler,
    PrinterHealthDiagnostic Printer, PrinterOperationKind ActiveOperation);
public sealed record SupervisorTransition(PrinterSupervisorState State,
    SupervisorDecision Decision, bool StateChanged, int AttemptsInWindow);
```

`Observe` counts samples and returns decisions without I/O. `CompleteRecovery(false)` records a failure after pruning the rolling window. Physical faults return `None`. `BeginManualHalfOpen` succeeds only from `CircuitOpen` with no active operation.

- [ ] **Step 4: Run focused/full tests and commit**

Run the focused test and full Worker suite, then:

```powershell
git -C ../printbit-worker add -- src/PrintBit.Infrastructure.Windows/PrinterMonitoring/PrinterSupervisorStateMachine.cs src/PrintBit.Infrastructure/Services/PrintService/ISystemClock.cs tests/PrintBit.Tests/PrinterSupervisorStateMachineTests.cs
git -C ../printbit-worker commit -m "feat: add printer recovery circuit breaker"
```

---

### Task 4: Hosted supervisor and automatic recovery

**Repository:** `../printbit-worker`

**Files:**
- Create: `src/PrintBit.HardwareService/Services/PrinterSupervisorService.cs`
- Modify: `src/PrintBit.Infrastructure.Windows/PrinterMonitoring/PrinterRecoveryService.cs`
- Modify: `src/PrintBit.Infrastructure/Services/PrintService/IPrinterRecoveryService.cs`
- Modify: `src/PrintBit.Infrastructure/IPC/WorkerEventPipeClient.cs`
- Test: `tests/PrintBit.Tests/PrinterSupervisorServiceTests.cs`
- Test: `tests/PrintBit.Tests/PrinterRecoveryServiceTests.cs`

**Interfaces:**
- Consumes: Tasks 1-3 and existing Worker event publisher.
- Produces: singleton `IPrinterSupervisor`, five-second snapshots, automatic repair, and manual half-open behavior.

- [ ] **Step 1: Write failing hosted-service tests**

Test increasing sequences, stopped-service start after sample two, queue-fault restart after sample two, physical-fault no-op, busy-print deferral, circuit opening on failure three, and manual half-open success/failure. Inject a manual tick source so tests never sleep.

- [ ] **Step 2: Run tests and verify RED**

Run: `dotnet test ../printbit-worker/tests/PrintBit.Tests/PrintBit.Tests.csproj --no-restore --filter "FullyQualifiedName~PrinterSupervisorServiceTests|FullyQualifiedName~PrinterRecoveryServiceTests"`

Expected: compilation/tests fail before the hosted service exists.

- [ ] **Step 3: Separate repair action from policy**

Add `AttemptRepairAsync(SupervisorDecision, CancellationToken)`. `StartSpooler` calls `StartAsync`; `RestartSpooler` calls `RestartAsync`. Preserve the existing diagnostic-derived overload for command compatibility. Both acquire the recovery lease and perform the existing post-action health recheck.

- [ ] **Step 4: Implement the hosted loop**

Each `PeriodicTimer` tick queries service/printer/operation state, feeds `Observe`, executes the decision, completes the state transition, increments sequence with `Interlocked.Increment`, and calls `PublishSupervisorAsync(snapshot)`. Publish transitions immediately and a heartbeat every tick. Map internal `CircuitOpen` to public `Maintenance`; pipe failures only log warnings.

- [ ] **Step 5: Run focused/full tests and commit**

Run Step 2 and the full Worker suite, then:

```powershell
git -C ../printbit-worker add -- src/PrintBit.HardwareService/Services/PrinterSupervisorService.cs src/PrintBit.Infrastructure.Windows/PrinterMonitoring/PrinterRecoveryService.cs src/PrintBit.Infrastructure/Services/PrintService/IPrinterRecoveryService.cs src/PrintBit.Infrastructure/IPC/WorkerEventPipeClient.cs tests/PrintBit.Tests/PrinterSupervisorServiceTests.cs tests/PrintBit.Tests/PrinterRecoveryServiceTests.cs
git -C ../printbit-worker commit -m "feat: supervise and recover print spooler"
```

---

### Task 5: Worker admission, stuck detection, IPC, diagnostics, and DI

**Repository:** `../printbit-worker`

**Files:**
- Create: `src/PrintBit.Infrastructure.Windows/PrinterMonitoring/IPrintServiceEventReader.cs`
- Create: `src/PrintBit.Infrastructure.Windows/PrinterMonitoring/PrintServiceEventReader.cs`
- Modify: `src/PrintBit.Infrastructure/Services/PrintService/DocumentPrinter.cs`
- Modify: `src/PrintBit.Infrastructure/Services/PrintService/JobOrchestrator.cs`
- Modify: `src/PrintBit.HardwareService/Services/WorkerCommandPipeHostedService.cs`
- Modify: `src/PrintBit.HardwareService/Program.cs`
- Modify: `src/PrintBit.HardwareService/appsettings.json`
- Modify: `tests/PrintBit.Tests/DocumentPrinterTests.cs`
- Modify: `tests/PrintBit.Tests/JobOrchestratorTests.cs`
- Modify: `tests/PrintBit.Tests/WorkerCommandPipeTests.cs`
- Modify: `tests/PrintBit.Tests/ProgramRegistrationTests.cs`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: fail-closed Worker dispatch, progress deadlines, command wiring, PrintService correlation, and production registration.

- [ ] **Step 1: Write failing behavior tests**

Add tests proving the supervisor blocks `IDocumentPrinter`, the print lease is acquired before the final readiness check, a four-page no-progress deadline is 180 seconds, a 100-page deadline caps at 900 seconds, progress resets the deadline, and physical faults remain governed by patience mode. Command tests prove status reads `CurrentSnapshot` and retry calls `AttemptManualRecoveryAsync`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `dotnet test ../printbit-worker/tests/PrintBit.Tests/PrintBit.Tests.csproj --no-restore --filter "FullyQualifiedName~DocumentPrinterTests|FullyQualifiedName~JobOrchestratorTests|FullyQualifiedName~WorkerCommandPipeTests|FullyQualifiedName~ProgramRegistrationTests"`

Expected: new tests fail before admission and wiring exist.

- [ ] **Step 3: Implement final admission and no-progress timeout**

After acquiring the print lease, re-read `IPrinterSupervisor.IsReady`; return a typed preflight failure without invoking `IDocumentPrinter` when false. In `DocumentPrinter`, calculate `min(capMinutes * 60, baseSeconds + perPageSeconds * expectedPages)` and reset `lastProgressAt` only when spooler state, `PagesPrinted`, or `TotalPages` changes.

- [ ] **Step 4: Wire recovery commands and diagnostics**

Route `GetPrinterRecoveryStatus` to the current snapshot and `AttemptPrinterRecovery` to manual half-open recovery while preserving request IDs and the 8192-byte limit. `IPrintServiceEventReader.ReadRecentFailureIds(DateTime sinceUtc)` reads the preceding five minutes from `Microsoft-Windows-PrintService/Operational`; disabled/missing/access errors log once and return an empty list. Invoke it only after failed recovery or circuit opening.

- [ ] **Step 5: Register, configure, validate, and document**

Register one `PrinterSupervisorService` as singleton `IPrinterSupervisor` and hosted service. Add all defaults to `appsettings.json`, set `SupervisorEnabled` explicitly, and call `ValidateOnStart`. Update AGENTS.md architecture, key classes, DI, settings, return event, recovery matrix, safety rules, and allowed tests.

- [ ] **Step 6: Run Worker verification and commit without README.md**

```powershell
dotnet test ../printbit-worker/printbit-worker.slnx --no-restore
dotnet build ../printbit-worker/printbit-worker.slnx --no-restore
git -C ../printbit-worker add -- src/PrintBit.Infrastructure.Windows/PrinterMonitoring/IPrintServiceEventReader.cs src/PrintBit.Infrastructure.Windows/PrinterMonitoring/PrintServiceEventReader.cs src/PrintBit.Infrastructure/Services/PrintService/DocumentPrinter.cs src/PrintBit.Infrastructure/Services/PrintService/JobOrchestrator.cs src/PrintBit.HardwareService/Services/WorkerCommandPipeHostedService.cs src/PrintBit.HardwareService/Program.cs src/PrintBit.HardwareService/appsettings.json tests/PrintBit.Tests/DocumentPrinterTests.cs tests/PrintBit.Tests/JobOrchestratorTests.cs tests/PrintBit.Tests/WorkerCommandPipeTests.cs tests/PrintBit.Tests/ProgramRegistrationTests.cs AGENTS.md
git -C ../printbit-worker commit -m "feat: enforce supervised printer admission"
```

Expected: tests/build pass; `README.md` remains modified and uncommitted.

---
