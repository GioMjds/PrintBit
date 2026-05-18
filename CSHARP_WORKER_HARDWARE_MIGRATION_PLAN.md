# PrintBit Hardware Migration Plan: Node.js → C# Worker Service

## 1) Objective

Migrate hardware and printer execution responsibilities from Node.js/Express services into a dedicated **C# Worker Service** while keeping Node.js as the API, auth, and persistence orchestration layer.

Primary hardware scope:

- ESP32 bridge and coin ingestion
- Coin acceptor / hopper serial operations
- SSR control
- Epson L5290 print execution and spooler monitoring

---

## 2) Recommended Target Architecture

## Keep in Node.js (authoritative app layer)

- Session/auth/admin APIs
- Upload and print job creation
- SQLite repository and ledger (`src/core/database/**`)
- Financial settlement and audit trail
- Real-time UI events (Socket.IO)

## Move to C# Worker (hardware execution layer)

- Serial manager (single owner of COM port lifecycle)
- Hopper dispense + status operations
- SSR state operations
- Print dispatch chain (PDFtoPrinter, GhostScript, LibreOffice, optional Sumatra fallback)
- Windows spooler monitoring
- Hardware watchdog and health probes

## Integration contract

- Node → Worker: HTTP internal commands (dispatch, hopper, SSR, diagnostics)
- Worker → Node: signed status callbacks/events (job state, faults, coin events)
- Optional WebSocket stream from Worker to Node for live telemetry

---

## 3) End-to-End Flows

## 3.1 Print flow

1. UI submits print request to Node.
2. Node validates, prices, persists `queued` job.
3. Node sends dispatch command to Worker with job metadata.
4. Worker executes print strategy and monitors spooler.
5. Worker sends status callbacks (`printing`, `completed`, `failed`) to Node.
6. Node updates DB and emits UI updates.

## 3.2 Coin flow

1. ESP32 sends coin signal/event to Worker (serial or HTTP bridge).
2. Worker validates source and applies **first-layer idempotency** cache on `x-coin-event-id`.
3. Worker forwards coin event to Node internal endpoint.
4. Node performs **authoritative idempotency** and ledger update.
5. Node emits updated kiosk balance.

## 3.3 Change dispense flow

1. Node requests dispense (coins count, request id).
2. Worker acquires hopper lock.
3. Worker executes serial/ESP32 dispense protocol.
4. Worker returns success/failure and partial-dispense metadata.
5. Node records settlement outcome.

---

## 4) C# Worker Modules

1. **Hardware.SerialManager**
   - Single serial port owner
   - Newline-delimited ASCII command handling
   - Reconnect with backoff and port fault telemetry

2. **Hardware.CoinBridge**
   - Header/auth validation parity (`x-coin-source`, `x-coin-api-key`, `x-coin-event-id`)
   - Replay suppression and retry-safe forwarding

3. **Hardware.HopperService**
   - Mutual exclusion for dispense operations
   - Timeout, retry policy, partial completion handling

4. **Hardware.SsrService**
   - Explicit on/off commands
   - Fail-safe OFF on worker shutdown or fatal fault

5. **Printing.Dispatcher**
   - Preserve dispatch mode behavior:
     - `legacy`
     - `phased`
     - `new-only`
   - Binary probing, process execution, timeout strategy

6. **Printing.SpoolerMonitor**
   - Poll queue status and correlate job progression
   - Detect stuck/paused/offline conditions

7. **Infra.Security**
   - Internal auth (API key/HMAC)
   - Timestamp + nonce replay protection

8. **Infra.Observability**
   - Structured logs (jobId, requestId, eventId)
   - Health endpoints and heartbeat

---

## 5) Current Node.js Files to Decommission (Post-Cutover)

Decommission only after parity is verified:

- `src/services/serial.ts`
- `src/services/hopper.ts`
- `src/services/hopper-protocol.ts`
- `src/services/printer.ts`
- `src/services/print-dispatcher.ts`
- `src/services/print-spooler.ts`
- `src/services/printer-monitor.ts`
- `src/services/windows-printer-edge.ts`
- `src/services/printer-status.ts`
- `src/services/test-page.ts` _(if moved to Worker diagnostics API)_

Do **not** remove authoritative finance/auth/persistence components.

---

## 6) Removal Strategy by Phase

## Phase A — Shadow Mode (no deletion)

- Introduce Worker service and run in passive/shadow mode.
- Keep Node path as active executor.
- Compare telemetry and outcomes.

## Phase B — Controlled Cutover

- Feature-flag to Worker as active executor.
- Keep Node fallback for rollback.
- Validate reliability over sustained volume.

## Phase C — Decommission Node hardware executors

- Remove file set above.
- Clean imports/routes and dead env vars from Node runtime.
- Keep Node as orchestration + persistence boundary.

## Phase D — Hardening

- Finalize runbooks and alerting.
- Lock down Worker service permissions and startup policy.

---

## 7) Epson L5290 + Spooler Requirements

- Use Windows queue as source of truth for physical print progression.
- Record process-level telemetry per attempt:
  - executable
  - exit code
  - duration
  - spooler-observed state transitions
- Handle failure classes explicitly:
  - process success but no spooler job appears
  - spooler job appears but never completes
  - queue paused/offline or service interruption

Dispatch order parity target:

1. PDFtoPrinter
2. GhostScript
3. LibreOffice
4. Sumatra fallback (mode-dependent)

---

## 8) API Contract First (Node ↔ Worker)

## Node → Worker

- `POST /worker/print-jobs/{jobId}/dispatch`
- `POST /worker/hopper/dispense`
- `GET /worker/hopper/status`
- `POST /worker/ssr/{on|off}`
- `GET /worker/health`

## Worker → Node (internal)

- `POST /api/internal/coins`
- `PATCH /api/internal/print-jobs/{jobId}/status`
- `POST /api/internal/hardware/events`

Status enum alignment:

- `queued | printing | completed | failed | blocked | refund_pending`

---

## 9) Trade-Off Decision

## Option A: Hybrid (Node + C# Worker) — **Recommended**

- Best risk profile
- Fastest iterative migration
- Preserves existing API/UI/DB contracts

## Option B: Full backend rewrite to .NET

- High regression risk
- Slower delivery

## Option C: Stay all-in Node

- Lower migration work, but weaker isolation for hardware/process reliability

Recommendation: **Option A** with phased rollout and rollback toggles.

---

## 10) Validation Checklist Before Deletion

- Coin idempotency validated under duplicate/retry storms
- Hopper lock prevents concurrent dispense races
- Dispatch mode parity validated across sample documents
- Spooler stuck/offline scenarios tested and recovered
- Financial ledger consistency verified under failure injection
- Internal auth and replay protections validated
- Operations docs/runbooks updated for Worker ownership

---

## 11) Suggested Repository Additions for Worker

```text
worker-hardware/
  src/
    Hardware/
      SerialManager.cs
      CoinBridge.cs
      HopperService.cs
      SsrService.cs
    Printing/
      Dispatcher.cs
      SpoolerMonitor.cs
      ProcessRunner.cs
    Contracts/
      Dtos/
      StatusEnums.cs
    Infra/
      Security/
      Observability/
      Health/
  appsettings.json
  appsettings.Production.json
```

This structure keeps hardware concerns isolated while Node remains system-of-record and API gateway.
