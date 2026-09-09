# PrintBit Printer Supervisor Design

**Date:** 2026-09-09

**Status:** Approved design

**Scope:** `printbit` Node.js kiosk application and the sibling `printbit-worker` .NET Windows Service

## Objective

Make printer-subsystem failures recoverable without accepting a paid transaction while printing is unavailable. The C# Worker becomes the authoritative supervisor for the Windows Print Spooler, Epson queue, active PrintBit job, and automatic recovery. Node projects that state, persists audit history, and fails closed at every transaction boundary.

The design extends the Worker infrastructure that already exists: `PrinterHealthMonitor`, `PrinterRecoveryService`, `ServiceControllerSpoolerController`, `PrintOperationCoordinator`, `JobOrchestrator`, and the Worker named pipes. It does not reintroduce Windows printer management in Node.

## Safety Invariants

1. Recovery never overlaps an active print or another recovery operation.
2. Physical faults never trigger a Spooler restart.
3. Automatic recovery never purges queue entries or deletes `.spl`/`.shd` files.
4. Existing job-specific failure cleanup may cancel only the correlated failed PrintBit job.
5. The kiosk cannot initiate print, copy, or payment commitment unless a fresh Worker snapshot says `ready`.
6. Coin acceptance remains locked while the snapshot is missing, stale, or not `ready`.
7. Sumatra process exit is not proof of print completion; the Worker spooler lifecycle remains authoritative.
8. Printer identity is an exact configured queue name. The current Windows port is discovered and reported, never fixed to `USB004`.

## Architecture and Ownership

### C# Worker

Add a singleton hosted `PrinterSupervisorService`. It polls every five seconds and combines:

- Spooler service status from `IPrintSpoolerController`;
- typed printer diagnostics from `IPrinterHealthMonitor`;
- active-operation state from `IPrinterOperationCoordinator`;
- correlated print-job progress from the existing queue/spooler lifecycle;
- recovery history and circuit-breaker state.

The service owns the internal states `Starting`, `Ready`, `Busy`, `Recovering`, `Maintenance`, and `CircuitOpen`. It publishes a snapshot every poll and publishes transitions immediately.

`JobOrchestrator` performs a final supervisor-readiness check while acquiring the print lease. A queue file may wait, but it cannot reach Sumatra while the printer subsystem is unhealthy. Acquiring the print lease atomically moves the supervisor from `Ready` to `Busy`, closing the race between a Node readiness check and actual dispatch.

### Node.js application

Node extends `printer-state-projection.ts` to consume supervisor snapshots. Node owns:

- fail-closed transaction and coin-slot gates;
- durable recovery and transition audit records;
- kiosk and administrator presentation;
- authenticated manual retry orchestration;
- financial reconciliation for terminal print failures.

Node does not query WMI, control the Spooler service, inspect USB devices, or launch Epson tools.

## State Machine

```text
Starting -> Ready <-> Busy
    |        |       |
    +--------+-------+-> Recovering -> Ready
                            |
                            +-> Maintenance
                            +-> CircuitOpen
```

### Health confirmation

- Two consecutive unhealthy samples are required before automatic recovery.
- Physical faults bypass the two-sample recovery trigger and enter `Maintenance` immediately because delaying paper-out or jam presentation has no benefit.
- Two consecutive healthy samples return `Maintenance` to `Ready` when no recovery circuit is open and no print lease is held.

### Recovery levels

1. **Healthy:** no action.
2. **Spooler stopped:** start the service and wait for `Running`; do not perform a redundant stop.
3. **Spooler running with a Windows-side queue fault:** perform one controlled restart.
4. **Physical fault or unsuccessful repair:** enter `Maintenance` or `CircuitOpen`, as applicable.

The recovery lease is non-blocking. If a print owns the lease, the supervisor reports the fault but does not restart the Spooler. Recovery is reconsidered after the print releases the lease.

### Circuit breaker

- Record failed automatic recovery attempts in a rolling ten-minute window.
- Three failed attempts open the circuit and suppress further automatic recovery.
- An authenticated administrator retry performs one half-open attempt.
- A successful half-open attempt closes the circuit and restores normal sampling.
- A failed half-open attempt leaves the circuit open.

## Stuck-Job Detection

The current two-minute Sumatra process timeout remains unchanged. Spooler progress additionally uses this deadline:

```text
60 seconds + (30 seconds * selected page count), capped at 15 minutes
```

The deadline measures absence of meaningful lifecycle progress, not total wall-clock print duration. A change in spooler state, `PagesPrinted`, or another accepted progress marker resets the deadline. Paper-out, jam, door-open, ink/service faults, or other physical faults pause failure escalation and remain governed by the existing printer-health patience behavior.

When a job is confirmed stuck, it becomes a terminal failure for that correlated PrintBit job. Existing job-specific cleanup may cancel that job. Stuck detection never authorizes a blanket queue purge.

## IPC Contract

Add `PrinterSupervisorSnapshot` to the Worker return-pipe event union. The payload is:

```json
{
  "type": "PrinterSupervisorSnapshot",
  "sequence": 1842,
  "timestampUtc": "2026-09-09T14:26:12Z",
  "status": "ready",
  "spooler": {
    "status": "Running",
    "responsive": true
  },
  "queue": {
    "status": "idle",
    "activeJobId": null
  },
  "printer": {
    "name": "EPSON L5290 Series",
    "portName": "USB004",
    "connected": true,
    "issueKind": "None",
    "message": null
  },
  "recovery": {
    "attemptsInWindow": 0,
    "circuitOpen": false,
    "lastAction": null
  }
}
```

The public `status` values are `ready`, `busy`, `recovering`, and `maintenance`. Internal `CircuitOpen` maps to `maintenance` on the kiosk-facing contract.

`sequence` is monotonically increasing for the lifetime of one Worker process. Node also tracks the Worker connection epoch: a newly connected Worker's first snapshot starts a new epoch, so its lower sequence number is accepted. Within an epoch, Node rejects duplicate or out-of-order snapshots.

Existing command-pipe support is extended in Node for `GetPrinterRecoveryStatus` and `AttemptPrinterRecovery`. Recovery requests use a response deadline of at least 45 seconds.

## Fail-Closed Transaction Gating

Node begins in a blocked state. A snapshot is fresh for 15 seconds from local receipt time; the Worker-provided timestamp is retained for audit but is not trusted for freshness calculations.

When the state is missing, stale, or not `ready`, Node:

1. acquires the existing coin-slot lock with owner `printer-supervisor`;
2. disables print and copy controls;
3. rejects server-side print and copy initiation;
4. rejects final payment commitment and Worker handoff;
5. exposes the current maintenance/recovery state to kiosk and admin clients.

When a fresh `ready` snapshot arrives, Node releases only the `printer-supervisor` lock. Other lock owners, including power safety, remain intact.

The UI is not a security boundary. All state-changing routes and service entry points enforce the same server-side readiness predicate immediately before committing a paid operation.

## Administrator Operations

Add authenticated administrator endpoints for:

- current supervisor/recovery status;
- one manual half-open retry;
- recovery-attempt history and latest diagnostic context.

Manual retry cannot bypass the print/recovery lease and cannot repair physical faults by restarting the Spooler.

A destructive queue purge is outside this implementation. If introduced later, it must be a distinct authenticated command with explicit confirmation, transaction correlation, audit logging, and safeguards against deleting unrelated jobs.

## Observability

Worker structured logs record:

- unhealthy samples and their typed classification;
- state transitions;
- configured printer name and discovered port;
- active job/correlation identity when present;
- recovery level, action, duration, and outcome;
- rolling failure count and circuit changes;
- stuck-job deadline and last progress marker.

Healthy polling cycles are not logged at information level. Snapshots still publish every cycle for liveness.

Node durably records state transitions, automatic and manual recovery attempts, request IDs, outcomes, circuit changes, printer identity, port, and timestamps.

On a failed recovery or circuit opening, a best-effort Windows diagnostic reader queries relevant PrintService Operational events from the preceding five minutes and adds their event IDs to the structured Worker log. An unavailable or disabled event log produces one diagnostic warning and never changes the recovery outcome. Epson Connection Checker remains a technician-only tool and is never launched by PrintBit.

## Configuration

Extend Worker `PrinterRecoverySettings` with validated defaults:

| Setting                          | Default |
| -------------------------------- | ------: |
| `SupervisorPollIntervalSeconds`  |       5 |
| `UnhealthySamplesBeforeRecovery` |       2 |
| `HealthySamplesBeforeReady`      |       2 |
| `CircuitBreakerFailureLimit`     |       3 |
| `CircuitBreakerWindowMinutes`    |      10 |
| `StuckBaseTimeoutSeconds`        |      60 |
| `StuckPerPageTimeoutSeconds`     |      30 |
| `StuckTimeoutCapMinutes`         |      15 |

Existing Spooler transition and health-recheck settings remain in force. Invalid non-positive timing values or limits fail configuration validation at Worker startup rather than silently weakening safety. Node separately defines `PRINTER_SUPERVISOR_STALE_MS=15000`; tests and deployment validation require it to remain greater than two Worker poll intervals.

## Deployment Hardening

Deployment tooling performs an idempotent change to disable USB selective suspend for the kiosk's active power plan and verifies the resulting setting. It does not blindly modify every USB hub's registry configuration. Per-device `Allow the computer to turn off this device to save power` remains an installation checklist item because device-instance identities vary by tablet and re-enumeration.

The service continues to run with the privileges required for `ServiceController` operations. The kiosk account remains restricted, and recovery commands retain the existing administrator/System-only pipe ACL.

## Testing

### Worker unit tests

Use fake time, spooler controller, health monitor, queue-progress source, operation coordinator, and snapshot publisher to cover:

- startup and healthy confirmation;
- stopped-service start versus running-service restart;
- physical-fault bypass;
- recovery deferred while printing;
- all state transitions;
- rolling-window pruning and circuit opening;
- successful and failed half-open attempts;
- page-aware stuck deadlines and progress resets;
- monotonically increasing snapshot sequence;
- prohibition of queue purge operations.

### Contract and Node tests

- Exact C#/TypeScript serialization compatibility.
- Worker epoch and sequence handling.
- Fifteen-second stale-snapshot behavior using a fake clock.
- Coin locking and owner-safe unlocking.
- Server-side print, copy, payment, and handoff rejection.
- Restoration only after a fresh `ready` snapshot.
- Recovery command timeout and malformed-response handling.
- Durable recovery audit records.

### Windows and tablet verification

Repository-local Windows tests exercise `ServiceController` start/restart behavior without destructive queue operations. Target-tablet validation covers:

1. stopped Spooler;
2. temporary USB disconnect;
3. paper-out and recovery;
4. a stalled correlated PrintBit job;
5. Worker disconnect and stale snapshot;
6. three failed recoveries and circuit opening;
7. authenticated administrator retry;
8. return to service after verified health.

## Rollout

1. Ship the Worker snapshot contract and supervisor behind `PrinterRecoverySettings:SupervisorEnabled`, defaulting to `false` in development and explicitly enabled in kiosk production configuration.
2. Ship Node projection, audit, and gates with compatibility handling for Workers that do not yet emit supervisor snapshots; compatibility remains fail-closed for paid operations.
3. Deploy and enable the Worker first while the old Node version safely ignores the new event, then validate snapshots on the target tablet before deploying Node.
4. Run the tablet fault-injection checklist before campus operation.
5. Remove the temporary feature flag after one stable deployment cycle; fail-closed behavior remains permanent.

## Explicit Non-Goals

- Automatic or blanket spool-file deletion.
- Automatic PnP/USB device reset.
- Launching or automating Epson Connection Checker.
- Treating Sumatra exit as print completion.
- Moving financial reconciliation or durable transaction state into C#.
- Reintroducing direct Windows printer management in Node.
