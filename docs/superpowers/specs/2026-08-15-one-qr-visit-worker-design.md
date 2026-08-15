# PrintBit One-QR Visit and Print Worker Coordination Design

**Status:** Approved design; implementation not yet complete  
**Date:** 2026-08-15  
**Repositories:** `printbit` (Node.js kiosk) and `printbit-worker` (.NET 10 Windows printer worker)

## Problem

Today a visitor must first join the ESP32 `PrintBit` Wi-Fi network and then use separate feature-specific QR codes or tokenized pages for upload, scan download, feedback, reports, and receipts. This creates repeated pairing, repeated QR scanning, and unclear ownership of kiosk state.

The print worker is also a separate process. Node hands it a PDF plus JSON sidecar through a shared queue and receives lifecycle messages through a named pipe. Those messages are currently best-effort, which is insufficient for a visit that must not close while a print is active.

## Goals

- One Wi-Fi QR and one explicit kiosk-approved phone pairing per customer visit.
- Print is the default post-pairing experience: phone opens upload; kiosk opens print receiving.
- One paired phone is the sole customer companion for uploads, scan downloads, receipts, feedback, and reports.
- Kiosk retains all hardware, payment, price, print dispatch, pause/resume, copy, and scan controls.
- Unused and unowned money is returned safely, idempotently, and with owed-change accounting.
- Node and C# can be deployed independently during rollout without breaking current print jobs.
- No automatic reprint after a worker restart when print outcome is ambiguous.

## Non-goals

- Internet access, cloud identity, or remote receipt delivery.
- Moving ESP32 coin/hopper logic into the C# worker.
- Passing mobile cookies, upload tokens, pairing codes, or `visitId` to the C# worker.
- Replacing the existing print engine, printer health checks, page-level dispatch, or kiosk admin security.

## Accepted Decisions

| Decision | Chosen behavior |
| --- | --- |
| Network topology | Keep the ESP32 dedicated WPA SoftAP: ESP32 `192.168.4.1`, kiosk `192.168.4.2:3000`. |
| Customer entry | The idle kiosk shows one standard Wi-Fi QR and a printed fallback URL to `/portal`. |
| Pairing | Phone requests access; kiosk operator confirms a matching six-digit code. A second phone receives `KIOSK_IN_USE`. |
| Customer ownership | One pending or active visit exists at a time. The approved owner has an HttpOnly, SameSite=Strict visit cookie. |
| Phone role | Companion only: upload, resource download, receipts, feedback, reports, live status, and Done. |
| Kiosk role | All hardware and payment action remains kiosk-only and loopback-protected. |
| Default service | Approval opens mobile Print upload and kiosk Print receiving. Copy and Scan remain available from kiosk Home. |
| Session expiry | Five minutes of meaningful inactivity, warning at 60 seconds. Heartbeat records presence but does not itself prevent expiry. |
| Disconnect handling | After 30 seconds without mobile heartbeat, block starting new work while allowing reconnect and current work to finish. |
| In-flight work | Print, copy, scan, settlement, and hopper payout defer Done/expiry until terminal state. |
| Scan delivery | Visit-authorized download for 15 minutes or visit end; warn about undownloaded scans before Done. |
| Receipts | Print, copy, and scan receipts appear in the mobile Inbox; tokenized receipt URLs retain the existing 24-hour lifetime. |
| Unowned coin | Immediately return through an idempotent hopper request; never assign it to the next visitor. |
| Workflow rollout | `PRINTBIT_VISIT_WORKFLOW=legacy|visit`, with `legacy` as the default and a canary kiosk first. |
| Worker ownership | Node owns visits and maps transactions to visits. The C# worker receives only transaction/correlation data and print settings. |

## Target Architecture

```text
Phone -- one Wi-Fi QR --> ESP32 SoftAP -- captive redirect --> Node /portal
                                                               |
Kiosk Edge (127.0.0.1) -- kiosk cookie --> Node Visit Orchestrator
                                                               |
                    visitId -> transactionId -> spoolerCorrelationKey
                                                               |
                       PDF + v2 JSON sidecar -> C# queue watcher
                                                               |
          live pipe event + durable terminal outbox -> Node worker-event inbox
                                                               |
                    authenticated visit room -> Phone Inbox/status
```

The ESP32 is only the local network and coin/hopper bridge. Node is the customer-session, payment, and workflow authority. The C# process remains a printer bridge and must not know the customer identity or visit state.

## Visit Model

### State

```text
pending -> active -> ending -> ended | expired
pending -> rejected | expired
```

`ending` blocks new customer work but permits trusted terminal callbacks. The end reason is stored separately from the state.

### Operation

```text
idle | print | copy | scan | payment | printing | dispensing
```

- `print` is document preparation and does not suppress normal idle behavior.
- `copy`, `scan`, `payment`, `printing`, and `dispensing` represent server-tracked critical work and defer closure.
- Waiting for coins is not an indefinite critical operation; an inserted coin is meaningful activity.

### Persistence

Node adds repository-backed records:

- `visit_sessions`: lifecycle, claim/owner/handoff token hashes, pairing code, activity/presence timestamps, current operation, end reason, and balance ownership reference.
- `visit_resources`: one typed row per upload session, scan, transaction, receipt, feedback session, and report session.
- `balance_returns`: idempotent payout request, requested and actual amount, hopper request ID, state, and owed-change link.
- `worker_event_inbox`: terminal worker event ID, payload hash, processing state, and timestamps.

`runtime_state` gains `balanceOwnerVisitId`. Receipt migration expands the `receipt_records.mode` check constraint to include `scan` while preserving records and receipt access tokens.

## Customer Flow

1. Idle kiosk shows only the Wi-Fi QR and fallback local URL.
2. Phone joins `PrintBit`; ESP32 captive probing redirects to `/portal`.
3. The phone explicitly requests access. Node creates a two-minute pending claim and shows its six-digit code.
4. Kiosk displays the pending code. Operator approves or rejects through a loopback-only API.
5. Approval consumes the claim credential and mints the visit cookie. A one-time handoff link can transfer the phone from captive webview to the full browser.
6. Phone opens Print upload; kiosk opens Print receiving. Existing document validation, limits, preview, and analysis continue to apply.
7. Print/copy/scan status is delivered to the current visit only. Scan files and receipts enter the mobile Inbox without another QR.
8. Done, timeout, or a deferred end completes outstanding trusted work, returns unused balance, expires transient resources, and releases the kiosk.

## Public Interfaces

### Visit HTTP families

- Public: `GET /portal`, `GET /mobile`, `POST /api/visits/claims`, and claim-status/activation endpoints.
- Loopback kiosk control: `/api/kiosk/visits/**` for approval, rejection, activity, state, and end.
- Visit-authenticated companion: `/api/mobile/visit/**` for heartbeat, activity, Done, browser handoff, documents, Inbox resources, scan download, receipt access, feedback, and reports.

All public mutations use a consistent machine-readable error code. Important responses include `KIOSK_IN_USE`, `VISIT_EXPIRED`, `VISIT_ENDING`, `SESSION_EXPIRED`, and `RESOURCE_EXPIRED`.

### Worker sidecar v2

The existing top-level fields remain so an old worker can consume a new Node job:

```json
{
  "copies": 1,
  "color": false,
  "pageRange": null,
  "orientation": "portrait",
  "schemaVersion": 2,
  "transactionId": "...",
  "spoolerCorrelationKey": "..."
}
```

The updated worker validates that the v2 IDs match the queue filename. A mismatched, incomplete, or unsupported v2 envelope is quarantined without printing. Legacy setting-only sidecars remain valid.

### Worker events and commands v2

Worker events add optional `protocolVersion: 2`, `eventId`, and non-negative `sequence`. The terminal outcomes are:

```text
completed | failed | cancelled | partially_completed | unknown
```

Commands add optional `protocolVersion: 2` and `commandId`. Updated workers deduplicate a command ID per journal and reject conflicting reuse. Legacy frames remain accepted. No worker contract contains `visitId`.

## Worker Reliability Design

### Current issue

The return pipe proves only that bytes were sent, not that Node durably processed a terminal result. The queue watcher also currently processes files in place, so a crash after printing begins cannot safely decide whether reprinting is valid.

### Required behavior

- The worker claims sidecars into a processing area and creates an atomic job journal before dispatch.
- The journal records the correlation IDs, lifecycle state, page progress, and latest known outcome.
- A claimed-but-not-started job may resume after restart.
- A job that started printing is never automatically reprinted after a restart. If the spooler cannot prove the outcome, emit `unknown`, quarantine the files, and let Node create manual financial review.
- Before queue cleanup, write a compact terminal v2 event to a terminal outbox using temporary file plus atomic rename. The deterministic ID is `<spoolerCorrelationKey>:terminal`.
- Also write the live terminal event to the existing pipe. Node drains the outbox before startup recovery, processes event IDs exactly once, and deletes the outbox file only after durable handling succeeds.

## Financial Safety

- Coin-event idempotency remains keyed by `x-coin-event-id`; duplicate deliveries never credit or refund twice.
- A coin during an active visit belongs to that visit. A coin with no eligible owner becomes a durable unowned return and is queued for immediate hopper payout.
- On visit close, Node atomically snapshots and clears the owned balance into one return record before hardware payout.
- The hopper receives a stable persisted request ID. Partial payout records `dispensed`; only the unpaid remainder becomes owed change.
- Worker outcomes never directly move money. Node maps a zero-page failure/cancellation to visit-balance restoration; partial or unknown printing becomes pending review rather than a full automatic refund.

## Security and Privacy

- Kiosk control requires both loopback source and kiosk bootstrap cookie.
- Mobile cookie secrets, claim secrets, and handoff secrets are stored only as hashes.
- Mobile Socket.IO connections use a visit-authenticated namespace and server-assigned room; clients cannot choose rooms or control hardware events.
- Worker events are parsed as untrusted input, bounded by configured size, and matched to a persisted transaction resource before customer delivery.
- Logs contain opaque IDs and operational state, never tokens, pairing codes, Wi-Fi passwords, document content, or queue paths in mobile responses.

## Current Implementation Status

### Node.js `printbit`

**Existing before this initiative**

- ESP32 SoftAP configuration and captive `/portal` flow.
- Tokenized wireless uploads, independent feedback/report sessions, scan download tokens, receipt tokens, and print/copy/scan services.
- Named-pipe return server, worker queue handoff, transaction/recovery tracking, and kiosk bootstrap cookie.

**Already implemented in the current uncommitted working tree; not yet verified or committed**

- `PRINTBIT_WORKER_COMMAND_PIPE_NAME` configuration.
- v2 queue-sidecar fields: `schemaVersion`, `transactionId`, `spoolerCorrelationKey`.
- optional v2 worker-command fields: `protocolVersion`, `commandId`.
- optional v2 worker-event parsing, event ID/sequence validation, and terminal outcome validation.
- pause, resume, and cancel now generate command IDs and use the configured command pipe.
- focused Jest coverage for v1/v2 sidecars, commands, events, and printer-service pipe selection.

**Not yet implemented**

- Visit persistence, pairing, mobile companion, feature flag, mobile resource delivery, balance ownership/returns, worker event inbox, worker outbox consumer, and visit-aware Socket.IO authorization.

### C# `printbit-worker`

**Existing before this initiative**

- .NET 10 Windows printer worker with queue watcher, qpdf page splitting, page-level spooler verification, printer health monitoring, and named-pipe lifecycle events.
- Queue filename-derived `transactionId` and `spoolerCorrelationKey`.

**Already implemented in the current uncommitted working tree; not yet verified or committed**

- v2 sidecar validator accepting legacy setting-only files and rejecting incomplete/invalid/mismatched v2 envelopes.
- optional v2 event properties (`protocolVersion`, `eventId`, `sequence`) and a typed terminal outcome.
- command parser and named-pipe listener accepting legacy commands and validating complete v2 command envelopes.
- configured worker command pipe and Node-command listener registration.
- queue watcher failure quarantine and safer delete/move behavior.
- in-progress pause/resume/cancel orchestration, printer-health changes, and expanded xUnit tests.

**Not yet implemented**

- command-ID durable deduplication, processing directory, job journal, terminal outbox, restart-safe active-job recovery, and Node acknowledgement/deletion of terminal outcomes.

## Rollout

1. Finish and verify the additive v2 contract in both repositories while Node remains in legacy workflow mode.
2. Deploy Node with dual v1/v2 event support, worker event inbox, and terminal outbox consumer.
3. Deploy the worker with queue journals and terminal outbox support.
4. Verify the pair on one kiosk using known print, pause, cancel, restart, and recovery scenarios.
5. Enable `PRINTBIT_VISIT_WORKFLOW=visit` for that canary.
6. Roll back by flag only after open visits, worker journals, and balance-return records are reconciled.

## Documentation Obligations

Update the Node API, architecture, operations, ESP32 setup, and `agent_docs` files. Update the worker README and worker `AGENTS.md` for IPC settings, queue/journal lifecycle, and any changed worker state transitions.
