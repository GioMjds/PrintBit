# PrintBit Architecture

## Overview

PrintBit is a kiosk-oriented Express application with static frontends and hardware/service integrations.
The backend serves pages, exposes APIs, and coordinates print/copy/scan/payment state.

## Runtime layers

## 1) HTTP + realtime layer

- Entry point: `src/server.ts`
- Express handles API/page routes.
- Socket.IO broadcasts live machine events:
  - balance updates,
  - coin accepted events,
  - upload status notifications,
  - serial status.

## 2) Route layer (`src/routes`)

- `financial-routes.ts`: balance, pricing, payment confirm, legacy upload/print.
- `wireless-session-routes.ts`: mobile upload session lifecycle and previews.
- `upload-portal-routes.ts`: tokenized upload page rendering and asset serving.
- `copy-routes.ts`: copy job lifecycle.
- `scan-routes.ts`: scan and preview job lifecycle.
- `admin-routes.ts`: protected settings, status, logs, and maintenance endpoints.
- `page-routes.ts`: HTML page routing.

## 3) Database layer (`src/core/database`)

- `db.ts`: shared schema/runtime database facade backed by SQLite `runtime_state` table persistence.
- `sqlite-storage.ts`: SQLite persistence (`printbit.sqlite`) for operational domains (admin logs, feedback, report issues, receipts + receipt access tokens).

## 4) Service layer (`src/services`)

- `serial.ts`: coin input parsing, balance mutation, and hopper command transport (shared 115200-baud serial line).
- `hopper.ts`: coin hopper orchestration — dispense with retries, stats tracking, owed-change fallback.
- `hopper-protocol.ts`: Arduino hopper serial protocol contract (command builders, response parser, error codes).
- `settlement.ts`: shared payment settlement logic (charge balance + dispense change) used by print and copy flows.
- `printer.ts` + `print-dispatcher.ts`: mode-based print dispatch orchestration
  (`legacy`, `phased`, `new-only`) with engine adapters. Customer-selected
  print quality is carried in `PrintJobOptions`; the deployed C# worker must
  map it to a Windows printer queue whose driver preferences define Standard
  or High.
- `document-analysis.ts`: per-page coverage analysis for PDFs and images (pixel sampling for images, operator-based estimation for PDFs); returns classification (blank/bw/partial/full_color) and coverage (0.0-1.0).
- `pricing-engine.ts`: PH-localized pricing logic with threshold classification, proportional partial-page pricing, blank-page policy, bulk tier discounts, and whole-peso rounding.
- `print-quote.ts`: quote builder with optional pricing engine breakdown integration.
- `session.ts`: in-memory wireless upload session domain.
- `hotspot.ts`: ESP32 hotspot registration and network integration.
- `scanner.ts`: scanner adapter integration.
- `preview.ts`: document preview conversion/HTML generation.
- `admin.ts`: pricing calculations, logging, stats, reporting helpers.
- `job-store.ts`: in-memory copy/scan job state machine.
- `modules/receipt`: receipt domain APIs (token-based customer read + admin transaction-context read), token mint/verify helpers, lifecycle update helpers, and periodic expiry cleanup.

## 4) Frontend layer (`src/public`)

Static page modules for:

- print upload/session page
- upload page
- print config page
- confirm page
- copy page
- scan page
- admin pages

Frontend pages use REST APIs + Socket.IO to reflect machine state in near real-time.

## Data model

Persistent (`printbit.sqlite`):

- `balance`
- `earnings`
- `settings` (pricing, pricing engine config, admin settings, timeout)
- `coinStats`
- `jobStats`
- `logs`
- `analysisCache` (per-file hash, coverage/classification results)

Ephemeral (process memory):

- upload sessions (`SessionStore`)
- copy/scan jobs (`jobStore`)
- runtime process flags (serial/hotspot state)

## Main operational flows

## A) Print flow (wireless upload)

1. Kiosk creates session and QR.
2. Phone opens upload portal and uploads file.
3. Kiosk polls/receives upload completion.
   - Session ownership is single-device (`x-upload-client-id`) to prevent multi-phone collisions.
   - Session TTL is idle-based; clients receive countdown metadata and show warning before expiry.
   - On timeout, uploaded files are cleaned and session state is released.
4. Document analysis computes per-page coverage and classification (blank/bw/partial/full_color).
5. Quote endpoint returns legacy or enhanced pricing:
   - `legacy` mode: original pricing logic only.
   - `shadow` mode: both legacy and pricing engine breakdown (for validation).
   - `live` mode: pricing engine as billing source.
6. User selects print settings, including Standard or High quality.
7. Confirm endpoint validates funds using quote-consistent amounts and queues
   the print with the selected quality in the worker sidecar.
8. Settlement: balance zeroed, earnings updated, change dispensed via coin hopper.
9. Socket.IO emits balance update and change dispense status events.

## B) Document analysis (per-page pricing classification)

1. Document analysis service processes PDFs and images to compute per-page coverage.
2. For images: pixel sampling (bounded by max sample count) computes color pixel ratio (0.0-1.0).
3. For PDFs: operator-based analysis counts color-related operators as proportion of total operators.
4. Per-page classification applied:
   - blank: coverage < 0.05 → apply blankPagePolicy (charge_zero | charge_bw | charge_color).
   - bw: coverage <= bwMax threshold → base BW price.
   - partial: coverage between thresholds → proportional pricing (base + coverage × multiplier, capped at full color).
   - full_color: coverage >= fullColorMin → base color price.
5. Analysis results cached by file hash to avoid recomputation.
6. Results persisted in session documents and returned in quote response.

## C) Copy flow

1. Kiosk scans preview.
2. User confirms copy settings.
3. Copy job endpoint validates preview + funds.
4. Print dispatch runs asynchronously via job state updates.
5. Settlement: same as print — balance zeroed, change dispensed via hopper.

## D) Change dispensing (coin hopper)

1. Settlement logic computes `changeAmount = previousBalance - requiredAmount`.
2. If `changeAmount > 0`, hopper service requests payout in whole 1-peso coin count (serial `HOPPER DISPENSE ...` or ESP32 HTTP bridge, based on provider mode).
3. Hopper responses are validated against requested coin count; partial dispense is treated as failure and only the remaining unpaid amount is recorded as owed change.
4. Protocol defined in `hopper-protocol.ts`; request IDs are 4-char hex for Arduino memory efficiency.
5. Hopper only dispenses **1-peso coins** — all pricing enforced as whole-peso integers.
6. Settlement and audit logs track the **actual dispensed amount** (not just requested change).
7. On dispense failure, owed change is recorded for admin resolution (`owedChanges` in SQLite state).
8. Retries happen only for retryable error codes (JAM, MOTOR_TIMEOUT, PARTIAL).

## E) Admin flow

1. Admin authenticates with PIN.
2. UI reads summary/status/settings/logs.
3. Dashboard overview surfaces explicit open owed-change count alongside anomaly counts for faster payout reconciliation triage.
4. Transaction Logs support flow exposes row actions (`View details`, `Open E-Receipt`, `Copy ID`, `Create report`) and a unified investigation drawer backed by `GET /api/admin/transactions/:transactionId/context`.
5. Maintenance actions can reset balance, clear storage, update settings, export logs, and resolve owed changes.

## E) E-Receipt flow (v1 scope: print + copy)

1. On settled `POST /api/confirm-payment` for `mode: "print"` or `mode: "copy"`, the backend snapshots receipt data and mints an access token.
2. Customer receipt access uses `/receipt/t/:token` -> `GET /api/receipts/by-token/:token`.
3. Admin support uses transaction context (`GET /api/admin/transactions/:transactionId/context`) and receipt lookup (`GET /api/admin/transactions/:transactionId/receipt`) without exposing customer tokens.
4. Receipt snapshots persist change reconciliation (`requested`, `dispensed`, `remaining`, `state`, `owedChangeId`, `message`) so customer and admin views are deterministic.
5. Receipt records and access tokens default to 24-hour retention; cleanup runs at startup and then on a 15-minute interval.

## External dependencies

- PDFtoPrinter and GhostScript binaries for print dispatch; LibreOffice is owned by the C# conversion worker
- Optional Sumatra fallback in phased mode
- Serial device for coin input + coin hopper (shared 115200-baud line via Arduino Uno)
- ESP32 bridge firmware (`esp32-captive-portal.ino`) using WiFiManager STA-first provisioning with captive-portal fallback and long-press reprovision reset
- Scanner hardware adapter

## Design considerations

- Prioritizes kiosk availability even when optional hardware is unavailable.
- Uses strict request validation in most job endpoints.
- Uses mixed legacy and newer routes; migration toward unified APIs is ongoing.
- Session-based upload is preferred over direct anonymous upload to preserve per-user isolation, bounded lifetime, and deterministic cleanup between kiosk users.

## Dependency context

- Runtime and external software dependency details are documented in [INSTALLATION_AND_DEPENDENCIES.md](./INSTALLATION_AND_DEPENDENCIES.md).
- Operational installation notes and checks are in [OPERATIONS.md](./OPERATIONS.md).
