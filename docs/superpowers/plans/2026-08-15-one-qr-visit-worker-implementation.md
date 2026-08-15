# PrintBit One-QR Visit and Worker Coordination Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task-by-task. Each checkbox is a reviewable, testable increment.

**Goal:** Ship a single-pairing wireless visit workflow without weakening payment safety or losing printer outcomes across Node/C# process restarts.

**Architecture:** Node is the authoritative Visit Orchestrator, financial authority, and customer-facing server. The .NET worker remains printer-only, exchanging only print attempt identifiers and settings through a backward-compatible queue/IPC contract. Durable worker terminal results are replayed into Node exactly once.

**Tech Stack:** Node.js, Express, Socket.IO, strict TypeScript, SQLite repositories, static TypeScript clients, ESP32 firmware, .NET 10 Windows Worker Service, named pipes, shared queue directories, `pnpm`, and `dotnet test`.

## Global Constraints

- Use `pnpm`, never npm or yarn.
- Use repositories in `src/core/database/`; do not mutate SQLite files directly.
- Preserve `x-coin-event-id` behavior, ESP32 API-key validation, hopper request IDs, account security, and kiosk bootstrap checks.
- Keep C# printer-only; no mobile or payment authority crosses the process boundary.
- The Node and C# working trees are already dirty. Preserve those changes, integrate them deliberately, and do not reset either repository.
- `PRINTBIT_VISIT_WORKFLOW=legacy|visit` defaults to `legacy` until canary acceptance.
- Node verification: `pnpm exec tsc --noEmit --ignoreDeprecations 6.0`, `pnpm test -- --runInBand`, `pnpm run build`.
- Worker verification: `dotnet test printbit-worker.slnx -c Release`, `dotnet build printbit-worker.slnx -c Release`.

---

## Current Baseline to Preserve

### Node work already underway

- `src/services/worker-handoff.ts` writes an additive v2 sidecar envelope.
- `src/services/worker-command-pipe.ts` supports optional command v2 fields.
- `src/services/worker-return-pipe.ts` validates optional event v2 fields and terminal outcomes.
- `src/modules/printer/printer.service.ts` emits v2 pause/resume/cancel IDs through the configured command pipe.
- Corresponding Jest specs exist but their full suite has not been recorded as passing.

### Worker work already underway

- `PrintJobSidecarValidator` validates legacy and v2 sidecars.
- `WorkerCommandParser` and `WorkerCommandListenerHostedService` accept legacy/v2 commands.
- `WorkerPrintEvent` contains additive v2 fields.
- Queue safety and pause/resume/cancel work are in progress alongside printer-health changes.
- None of these uncommitted changes may be treated as shipped until the worker build and xUnit suite pass.

## File Map

| Area                        | Primary files                                                                                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node worker v2 contract     | `src/config/http.config.ts`, `src/services/worker-handoff.ts`, `src/services/worker-command-pipe.ts`, `src/services/worker-return-pipe.ts`                                                           |
| Node durable event handling | new `src/services/worker-terminal-outbox.ts`, new `src/core/database/models/worker-event.model.ts`, `src/core/database/sqlite-storage.ts`, `src/services/worker-print-lifecycle.ts`, `src/server.ts` |
| Node visits                 | new `src/modules/visit/`, `src/app.module.ts`, `src/modules/page/page.controller.ts`, `src/services/session.ts`                                                                                      |
| Node mobile client          | new `src/public/mobile/`, `src/public/print/`, `src/public/confirm/`, existing upload/feedback/report/receipt/scan clients                                                                           |
| Node payment safety         | `src/modules/financial/financial.service.ts`, `src/services/settlement.ts`, `src/services/hopper.ts`, `src/services/session.ts`, `src/core/database/models/payment.model.ts`                         |
| Worker contract             | `PrintJobSidecarValidator.cs`, `WorkerPrintEvent.cs`, `WorkerCommandMessage.cs`, `WorkerCommandParser.cs`, `WorkerCommandListenerHostedService.cs`                                                   |
| Worker durability           | new `WorkerJobJournal.cs`, new `WorkerTerminalOutbox.cs`, `PrintQueueWatcher.cs`, `JobOrchestrator.cs`, `HardwareSettings.cs`, `IpcSettings.cs`                                                      |

## Task 1: Stabilize and prove the v2 IPC contract

**Files:** Preserve the current Node and worker IPC edits; add only missing assertions and documentation.

**Produces:** A compatible v2 envelope where Node accepts v1/v2, old C# ignores added sidecar fields, and updated C# accepts v1/v2 inputs.

- [ ] Run the existing focused Node worker IPC tests and worker xUnit tests before further edits; record failures as baseline or regressions.
- [ ] Complete Node command-pipe configuration plumbing so all pause/resume/cancel callers use `WORKER_COMMAND_PIPE_NAME`.
- [ ] Complete worker `IpcSettings.WorkerCommandPipeName` binding and listener registration, retaining the default `printbit-worker-commands`.
- [ ] Keep sidecar v1 settings top-level; require all three v2 identity fields when any v2 identity field is present.
- [ ] Require v2 event `eventId` and non-negative integer `sequence`; allow unversioned legacy event frames.
- [ ] Require v2 command `protocolVersion: 2` and nonempty `commandId`; allow legacy command frames.
- [ ] Add mirrored contract fixtures covering legacy success, valid v2, incomplete v2, mismatched sidecar IDs, invalid terminal outcome, and command-pipe override.
- [ ] Verify Node can process old-worker output and updated worker can process old-Node sidecars before moving to durability work.

## Task 2: Add a restart-safe C# queue journal

**Files:** Create `WorkerJobJournal.cs`; modify `PrintQueueWatcher.cs`, `JobOrchestrator.cs`, `HardwareSettings.cs`, worker settings, and xUnit tests.

**Produces:** A claimed job cannot be silently duplicated after worker restart.

- [ ] Add `ProcessingDirectory` to `HardwareSettings`, defaulting to a sibling `processing` directory of the queue.
- [ ] Claim each PDF/JSON pair into the processing area before `ProcessJobAsync`; create an atomic journal with transaction ID, correlation key, state, page counters, and timestamps.
- [ ] Journal states are `claimed`, `printing`, and `terminal`; write `printing` before the first page dispatch and update completed counters after every confirmed page.
- [ ] On service startup, resume only a `claimed` job that has no printing journal entry.
- [ ] For a `printing` journal, inspect the matching spooler job. Continue monitoring only when it is provably active; otherwise write a terminal `unknown` outcome and quarantine the source files.
- [ ] Never requeue or automatically reprint a journal marked `printing` without a proven active spooler job.
- [ ] Keep existing semaphore serialization and user/hardware pause distinctions intact.
- [ ] Add xUnit coverage for claim-before-dispatch, safe restart of claimed work, no automatic reprint of printing work, known active spooler recovery, and unknown-outcome quarantine.

## Task 3: Persist and replay terminal worker outcomes

**Files:** Create `WorkerTerminalOutbox.cs`; modify worker event publication, `JobOrchestrator.cs`, settings, and tests.

**Produces:** A terminal print result survives Node downtime and worker restart.

- [ ] Add `TerminalOutboxDirectory` to `IpcSettings`; configure a local worker-owned directory with Node read/delete permission.
- [ ] Before queue cleanup, write one compact terminal v2 JSON file using `<spoolerCorrelationKey>:terminal` as `eventId`, temporary-file write, then atomic rename.
- [ ] Emit the same compact event through the return pipe for immediate UI updates.
- [ ] Retain terminal outbox files until Node has durably consumed them; do not use time-based deletion.
- [ ] Keep full per-page diagnostics in the journal/failed archive rather than allowing terminal pipe payloads to exceed the configured limit.
- [ ] Include `completed`, `failed`, `cancelled`, `partially_completed`, or `unknown` and the authoritative page counters in every terminal event.
- [ ] Add xUnit tests proving a terminal outbox record exists before source cleanup and is stable across repeat emission attempts.

## Task 4: Add Node worker-event inbox and recovery ordering

**Files:** Create `worker-event.model.ts` and `worker-terminal-outbox.ts`; modify `sqlite-storage.ts`, `worker-print-lifecycle.ts`, `recovery.ts`, `server.ts`, and Jest tests.

**Produces:** Pipe and file replay process each terminal event exactly once before startup refund logic runs.

- [ ] Add `worker_event_inbox` with unique `event_id`, `payload_hash`, `status`, transaction ID, correlation key, timestamps, and failure detail.
- [ ] Atomically claim the event ID before lifecycle work. A matching duplicate is a no-op; a reused ID with a different payload is quarantined and logged as a security/operational incident.
- [ ] Drain terminal outbox files after the Node return pipe starts and before `reconcileRecoverySessionsOnStartup()`.
- [ ] Poll the outbox while Node runs. Delete a file only after the corresponding event reaches processed state.
- [ ] Make terminal event handling replay-safe: receipt upsert, recovery checkpoint, transient-file cleanup, and refund/pending-review creation use transaction/correlation idempotency.
- [ ] Delay unknown-outcome startup reconciliation when queue or processing evidence proves the matching print remains active.
- [ ] Map completed to success; failed/cancelled with zero pages to restored visit balance; partially completed/unknown to `refunded_pending_review` without automatic full refund.
- [ ] Add Jest tests for pipe-plus-outbox duplication, Node restart before consumption, conflicting payload hashes, and no premature refund while the worker journal is active.

## Task 5: Build the persisted Visit Orchestrator

**Files:** Create `src/modules/visit/visit.types.ts`, `visit.repository.ts`, `visit.service.ts`, `visit.controller.ts`, and `visit.middleware.ts`; modify database schema, app registration, session service, and Socket.IO bootstrap.

**Produces:** A single authenticated customer visit controls all customer-facing resources without exposing kiosk control to the phone.

- [ ] Add `visit_sessions` and `visit_resources` repositories with transactional single-open-visit enforcement.
- [ ] Implement `pending`, `active`, `ending`, `ended`, `expired`, and `rejected` states plus the approved operation enum.
- [ ] Create an explicit two-minute pairing claim with six-digit code, kiosk approval/rejection, hashed claim/owner/handoff secrets, and one-time browser handoff.
- [ ] Set `printbit_visit` as HttpOnly and SameSite=Strict. Claim and handoff credentials are invalidated when consumed.
- [ ] Add loopback-plus-kiosk-cookie routes for approval, rejection, activity, and end. Add visit-cookie routes for companion actions.
- [ ] Separate mobile Socket.IO into an authenticated namespace and server-assigned visit room. Default kiosk events remain unavailable to unauthenticated phones.
- [ ] Track presence separately from meaningful activity; use five-minute expiry, 60-second warning, and 30-second reconnect grace.
- [ ] Set `printing` before Node queue handoff and release/defer visit ending only from replay-safe terminal worker handling.
- [ ] Add tests for claim races, second-phone isolation, handoff single use, loopback enforcement, reconnect, idle warning, expiry deferral, and restart restoration.

## Task 6: Implement the single-QR, print-first interface

**Files:** Create `src/public/mobile/`; modify page routes, kiosk Home/Print/Confirm clients, upload client, captive middleware, launcher scripts, and browser bundle configuration.

**Produces:** One Wi-Fi QR, one approval, and no downstream customer QR scans in visit mode.

- [ ] Render one standard Wi-Fi QR on the idle kiosk using the configured WPA credentials and display `http://192.168.4.2:3000/portal` as text fallback.
- [ ] Make `/portal` an explicit pairing screen, not a redirect to the latest upload session. Captive probes must not create claims.
- [ ] After approval, show mobile Print upload and kiosk Print receiving. Remove the existing startup Wi-Fi and upload QR sequence only when visit mode is enabled.
- [ ] Add companion screens for Print, Home, Inbox, Feedback, Report, connection status, and Done.
- [ ] Route upload operations through visit authentication while preserving file magic-byte checks, ownership, limits, analysis, previews, and cancellation semantics.
- [ ] Change Assigned Access and kiosk-control browser URLs to `127.0.0.1`; retain `192.168.4.2` for phone traffic and ESP32 registration.
- [ ] Add browser/manual acceptance checks for Android/iOS captive opening, full-browser handoff, file picker, and one-QR completion.

## Task 7: Link Copy, Scan, Receipts, Feedback, and Reports to visits

**Files:** Modify scanner, receipt, feedback, report, confirm, and mobile companion modules; update SQLite receipt migration and tests.

**Produces:** Every customer resource is delivered through the paired phone without a second QR.

- [ ] Link each underlying upload session, transaction, scan artifact, receipt record, feedback session, and report session to `visit_resources`.
- [ ] Replace in-memory visit-mode scan download tokens with visit-authorized resource download, 15-minute retention, acknowledgment tracking, and deletion at visit end.
- [ ] Extend `ReceiptMode` and SQLite constraint to `scan`; rebuild the constraint safely and preserve existing records/tokens.
- [ ] Generate scan transaction ID before settlement, then create a correct scan receipt using that ID.
- [ ] Deliver print/copy/scan receipts to Inbox and replace success-modal receipt QR with “Sent to your phone.”
- [ ] Keep existing tokenized receipt route as an internal/on-demand 24-hour receipt capability; mint it from the authenticated Inbox rather than displaying a QR.
- [ ] Make feedback/report feature sessions internal to the Visit Orchestrator and keep existing validation/attachments/admin workflows.
- [ ] Add tests for resource isolation, scan expiry, scan receipt mode, receipt delivery, feedback/report authorization, and a Done warning for unacknowledged scan resources.

## Task 8: Implement owned-balance return and ESP32 payout recovery

**Files:** Modify financial, settlement, hopper, session, and database repository code; update ESP32 firmware and payment tests.

**Produces:** No customer balance is silently cleared, transferred, or paid twice.

- [ ] Add `balanceOwnerVisitId` to persisted runtime state and bind accepted coins to the active visit in the same idempotent coin-event transaction.
- [ ] Remove the wireless-session creation balance reset in all workflow modes.
- [ ] Add `balance_returns` for visit-end, unowned-coin, legacy reconciliation, and settlement-change payout intents.
- [ ] When no eligible visit owns a coin, persist an unowned return keyed by the coin event before replying success; process it through the hopper queue.
- [ ] Snapshot and clear visit-owned balance atomically into one balance-return record before dispensing.
- [ ] Extend the hopper service and ESP32 protocol to accept stable request IDs, replay exact completed outcomes, preserve partial dispense counts, and reject same IDs with different parameters.
- [ ] On unknown hopper outcome after restart, do not run the motor again; record the unresolved amount as owed change.
- [ ] Add payment tests for duplicate coin IDs, unowned coin return, visit-end payout, partial payout, hopper failure, process restart, ESP32 restart, and no balance leak to the next visit.

## Task 9: Document, stage, and verify the release

**Files:** Update Node README, architecture, API, operations, ESP32 setup, `agent_docs`, worker README, and worker `AGENTS.md`.

**Produces:** Operators can deploy and roll back the coordinated change safely.

- [ ] Document every new route, cookie, environment variable, queue directory, terminal outbox directory, and worker state transition.
- [ ] Document that C# is printer-only and that Node remains the visit/payment authority.
- [ ] Add operational reconciliation steps for open visits, worker journals, terminal outbox backlog, unknown worker outcome, owed change, and flag rollback.
- [ ] Deploy Node dual-reader/outbox support in legacy mode first.
- [ ] Deploy the updated worker second and verify v1/v2 compatibility on kiosk hardware.
- [ ] Enable visit mode only for a canary kiosk after automated and physical acceptance passes.
- [ ] Record pairing success, reconnect, worker replay, unknown outcome, balance return, and owed-change telemetry without secrets.

## Acceptance Checklist

- [ ] A visitor completes print upload after one Wi-Fi QR scan and one kiosk approval.
- [ ] No downstream QR appears for upload, scan, feedback, report, or receipt in visit mode.
- [ ] A second phone cannot read the current visit or operate kiosk hardware.
- [ ] Done during printing waits for a terminal worker outcome.
- [ ] Node restart during terminal printing consumes the C# outbox once and produces the correct receipt/refund state.
- [ ] C# restart during active printing never duplicates output.
- [ ] All unowned and unused money has exactly one persisted payout or owed-change outcome.
- [ ] Legacy workflow remains usable until visit mode is explicitly enabled.
