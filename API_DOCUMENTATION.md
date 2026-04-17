# PrintBit API Documentation

Base URL: `http://<kiosk-ip>:3000`

## Authentication and access rules

- Most end-user routes are open on the local kiosk network.
- Admin APIs require:
  1. local-network access (when `adminLocalOnly` is enabled), and
  2. header `x-admin-pin: <PIN>`.

---

## System and hotspot

### `GET /api/config/hotspot`

Returns configured hotspot credentials.

### `POST /api/hotspot/start`

Starts hotspot process.

### `POST /api/hotspot/stop`

Stops hotspot process.

### `GET /api/session/active`

Returns currently active upload session token and URL (if available).

### `GET /portal`

Renders captive-portal bridge page for mobile users.

---

## Balance, pricing, and payment

### `GET /api/balance`

Returns current `balance` and `earnings`.

### `GET /api/pricing`

Returns pricing settings (`printPerPage`, `copyPerPage`, `colorSurcharge`).

### `POST /api/print/quote`

Returns a **server-verified print quote** (page counts + final amount) before payment.

Request:

```json
{
  "sessionId": "uuid",
  "documentId": "optional-selected-document-id",
  "copies": 2,
  "colorMode": "colored",
  "pageRange": { "type": "custom", "range": "1-3,5" },
  "duplex": true
}
```

Success response:

```json
{
  "ok": true,
  "sessionId": "uuid",
  "documentId": "doc_01H...",
  "filename": "my-file.pdf",
  "quote": {
    "requiredAmount": 48,
    "copies": 2,
    "duplex": true,
    "pageRange": "1-3,5",
    "totalPages": 9,
    "selectedPages": 4,
    "selectedColorPages": 2,
    "selectedBwPages": 2,
    "billableColorPages": 2,
    "billableBwPages": 2,
    "requestedColorMode": "colored",
    "effectiveColorMode": "colored",
    "pricing": {
      "printPerPage": 5,
      "colorSurcharge": 2
    }
  }
}
```

Notes:

- Page range is validated against analyzed document page count.
- If analysis is missing, endpoint returns `409`.
- Duplex affects print behavior only (per-page pricing remains unchanged).

### `POST /api/balance/reset`

Resets current balance to `0` (non-admin route currently available).

### `POST /api/balance/add-test-coin`

Testing/demo route to add synthetic coin values (`1`, `5`, `10`, `20`).

Request:

```json
{ "value": 5 }
```

### `GET /coin?value=<1|5|10|20>`

ESP32 compatibility route for captive-portal firmware coin forwarding.

- Intended caller: ESP32 AP firmware (`esp32-captive-portal.ino`)
- Valid values: `1`, `5`, `10`, `20`
- Required dedupe key: `eventId` query or `x-coin-event-id` header
- Required source: `source=esp32` query or `x-coin-source: esp32`
- Required auth: `x-coin-api-key: <configured-key>` header only (`apiKey` query is rejected)
- Simulation override: when `PRINTBIT_ESP32_COIN_BRIDGE_RELAXED=true`, `/coin?value=` is accepted without source/auth/eventId (not for production)
- Availability override: when `PRINTBIT_ESP32_ALWAYS_ACCEPT_COINS=true`, slot/printer safety gates do not reject ESP32 coin credits
- Duplicate `eventId` requests are idempotent and return `200` without double-crediting
- Rejected values return `400`
- Slot/printer gate rejections return non-2xx (`409`) with `{ retryable: true }` only when `PRINTBIT_ESP32_ALWAYS_ACCEPT_COINS=false`
- Concurrent in-flight idempotency collisions that fail resolution return `503` retry responses
- Accepted values emit the same balance/coin Socket.IO updates used by kiosk flows

### `POST /api/confirm-payment`

Primary confirmation endpoint for print/copy charging.

Request (print example):

```json
{
  "mode": "print",
  "sessionId": "uuid",
  "documentId": "optional-selected-document-id",
  "copies": 1,
  "colorMode": "grayscale",
  "orientation": "portrait",
  "paperSize": "A4",
  "pageRange": { "type": "all" },
  "duplex": false,
  "amount": 5
}
```

Response:

```json
{
  "ok": true,
  "transactionId": "uuid",
  "chargedAmount": 5,
  "balance": 0,
  "earnings": 100,
  "change": {
    "requested": 2,
    "dispensed": 2,
    "state": "dispensed",
    "attempts": 1
  },
  "print": {
    "state": "awaiting_spooler_terminal",
    "spoolerCorrelationKey": "uuid",
    "jobDispatchedAt": "2026-01-01T00:00:00.000Z",
    "monitorWindowMs": 180000
  },
  "receipt": {
    "transactionId": "uuid",
    "mode": "print",
    "status": "settled_pending_terminal",
    "token": "<opaque-access-token>",
    "tokenId": "uuid",
    "expiresAt": "2026-01-02T00:00:00.000Z",
    "viewUrl": "http://kiosk.local/receipt/t/<token>",
    "apiUrl": "http://kiosk.local/api/receipts/by-token/<token>"
  }
}
```

The `change` object is always present. `state` is one of `"none"`, `"dispensed"`, or `"failed"`. When `state` is `"failed"`, an `owedChangeId` and `message` are included — the owed change is recorded for admin resolution.
For print mode, `print.state: "awaiting_spooler_terminal"` means payment settled but terminal print success is still pending spooler confirmation.
`print.monitorWindowMs` reflects the backend spooler-monitor timeout window currently applied for that run.
`transactionId` is the canonical customer/admin reference ID for support and refund follow-up.
When receipt generation succeeds, `receipt` includes the token and prebuilt URLs for customer "View Receipt"/QR experiences.
E-Receipt v1 scope is `mode: "print"` and `mode: "copy"` (from `POST /api/confirm-payment`).
For `mode: "print"` in the modern flow, uploaded file deletion is finalized after spooler terminal success (not immediately at settlement).

### `GET /api/receipts/by-token/:token`

Customer-safe receipt endpoint using short-lived access tokens.
Default retention/expiry is 24 hours for both receipt snapshots and access tokens.

Response payload:

- `transactionId`
- `mode`
- `chargedAmount`
- `status`
- `settledAt`
- `terminalAt`
- `generatedAt`

Token status responses:

- `404` + `code: "RECEIPT_TOKEN_NOT_FOUND"` for unknown token
- `403` + `code: "RECEIPT_TOKEN_REVOKED"` for revoked token
- `410` + `code: "RECEIPT_TOKEN_EXPIRED"` for expired token

Public receipt pages:

- `/receipt/t/:token` (tokenized customer flow)
- `/receipt/:transactionId` (legacy compatibility flow)

### `GET /api/admin/transactions/:transactionId/receipt`

Admin-authenticated receipt lookup by transaction context (`requireAdminLocalAccess` + `requireAdminPin`).
Returns the same safe payload shape as token reads without exposing customer access tokens.
This is the API used by the Admin Transactions **Open E-Receipt** action.

Status responses:

- `400` when `transactionId` is missing
- `404` when receipt snapshot is not found
- `410` when receipt has expired

### `GET /api/transactions/:transactionId/receipt` (legacy compatibility)

Existing transaction-ID receipt endpoint is still available during migration and is used by `/receipt/:transactionId`.

For `mode: "print"`, the server now recomputes pricing from the same quote pipeline used by `/api/print/quote`, so displayed quote amount and charged amount stay aligned.

### Legacy endpoints

- `POST /upload` (single file upload, legacy path)
- `POST /print` (legacy print trigger using default options)

---

## Wireless upload sessions

Session-based upload is used to isolate each kiosk print flow, bind uploaded files to one in-progress print transaction, and enforce short-lived cleanup windows for privacy/resource safety.

Current lifecycle rules:

- Idle TTL is server-side and activity-based (session expires after 5 minutes of inactivity; uploads and session queries reset the timer).
- Session GET payloads return expiry metadata (`remainingSeconds`, `warningThresholdSeconds`).
- Expired sessions return HTTP `410` with `code: "SESSION_EXPIRED"` on wireless session APIs.
- Upload client ownership is single-device per session (via `x-upload-client-id` header—clients should generate a UUID v4 per device): concurrent phones receive `409` with `code: "SESSION_OWNED"`.

### `GET /api/wireless/sessions`

Creates a new wireless session.

### `GET /api/wireless/sessions/by-token/:token`

Resolves a session by token.

Requires header `x-upload-client-id` to claim/refresh upload ownership for that device.

### `GET /api/wireless/sessions/:sessionId`

Gets session details and uploaded document metadata.

### `GET /api/wireless/sessions/:sessionId/preview`

Returns preview content for uploaded file (PDF/image/HTML-converted).

### `POST /api/wireless/sessions/:sessionId/upload?token=<token>`

Uploads one file into the target session.

Requires header `x-upload-client-id` (must match the device that owns the session).

---

## Upload portal pages

### `GET /upload/:token`

Renders upload web page for tokenized session.

### `GET /upload/:token/:asset`

Serves upload page assets (`styles.css`, `app.js`).

---

## Scan APIs

### `POST /api/scan/jobs`

Creates a scan job.

### `GET /api/scan/jobs/:id`

Gets scan job status.

### `GET /api/scan/jobs/:id/result`

Downloads completed scan output.

### `POST /api/scan/preview`

Runs quick preview scan for copy flow and returns `previewPath` plus a short-lived `releaseToken` used for authorized cleanup.

### `GET /api/scan/preview/:filename`

Serves a saved preview scan file.

### `POST /api/scan/jobs/:id/cancel`

Requests scan job cancellation.

### `GET /api/scanner/status`

Returns scanner readiness for scan UI compatibility, including preferred device and basic capability info.

### `POST /api/scanner/scan`

Runs an interactive scan for the `/scan` page and returns preview page URLs, filename, and a short-lived `releaseToken` used for authorized cleanup.

**Body parameters:**

- `color` — `"color"` or `"grayscale"`. **Required.**
- `dpi` — `150`, `300`, or `600`. **Required.**

### `GET /api/scanner/wired/drives`

Lists currently detected removable USB drives.

When kiosk lockdown disables USB export (`PRINTBIT_USB_EXPORT_ENABLED=false`, or `PRINTBIT_KIOSK_LOCKDOWN=true` with no override), this endpoint returns:

```json
{
  "code": "USB_EXPORT_DISABLED",
  "error": "USB export is disabled in kiosk lockdown mode. Use wireless QR download instead."
}
```

with HTTP `423`.

### `POST /api/scanner/wired/export`

Exports a scanned file from `uploads/scans` to a selected removable USB drive.

When USB export is disabled by lockdown config, this endpoint returns the same `423` blocked response described above.

### `POST /api/scanner/wireless-link`

Creates a temporary tokenized download link for a scanned file.

### `POST /api/scanner/release`

Explicitly releases (deletes) a transient file from `uploads/scans` in an idempotent way.
Requires a valid short-lived `releaseToken` issued by scan/preview APIs.

Request:

```json
{
  "releaseToken": "d2c41f0c-5f8e-4515-b2f4-14f4053704f0",
  "reason": "scan_qr_done"
}
```

Response:

```json
{
  "ok": true,
  "deleted": true,
  "alreadyMissing": false
}
```

### `GET /scan/download/:token`

Downloads a scanned file using a temporary tokenized link.

---

## Copy APIs

### `POST /api/copy/jobs`

Creates a copy job from validated preview file. After successful print dispatch, charges balance and dispenses coin change via hopper (same settlement flow as print). The job `payment` field includes `chargedAmount` and `remainingBalance`.

### `GET /api/copy/jobs/:id`

Gets copy job status.

### `POST /api/copy/jobs/:id/cancel`

Requests copy job cancellation.

---

## Admin APIs

All routes below require admin local access + valid `x-admin-pin`.

Watchdog-facing routes are exempt from this admin contract and are loopback-only:

- `GET /api/watchdog/health`
- `GET /api/watchdog/report`
- `POST /api/watchdog/report`

### `POST /api/admin/auth`

Validates PIN.

### `GET /api/admin/summary`

Returns balance, earnings buckets, job stats, coin stats, storage, system status (including printer telemetry).

Also includes `consumables` forecasting output:

- `generatedAt`, `rollingWindowDays`, `alertDaysThreshold`
- `paper` forecast (`currentSheets`, `trayCapacitySheets`, `avgDailyUse`, `daysRemaining`, `projectedEmptyAt`, `status`, `confidence`)
- `inkSupplies[]` forecast (`name`, `level`, `avgDailyDrop`, `daysRemaining`, `projectedEmptyAt`, `status`, `confidence`, `detectionMethod`)
- `alerts` (`withinThreshold`, `reasons[]`)

The `status.printer` object contains:

```json
{
  "connected": true,
  "name": "HP LaserJet Pro",
  "driverName": "HP Universal Printing PCL 6",
  "portName": "USB001",
  "status": "Idle",
  "ink": [{ "name": "Ink / Toner", "level": null, "status": "unknown" }],
  "lastCheckedAt": "2026-03-06T12:00:00.000Z",
  "lastError": null
}
```

Each `ink` entry has:

- `level`: `0`–`100` when the driver exposes it, `null` otherwise.
- `status`: `"ok"` | `"low"` | `"empty"` | `"unknown"`.

### `GET /api/admin/status`

Returns system/runtime status (includes `printer` telemetry with the same shape as above).

Both `/api/admin/summary` and `/api/admin/status` now include:

```json
{
  "trustedTime": {
    "source": "ntp",
    "synced": true,
    "offsetMs": 12,
    "driftExceeded": false,
    "maxDriftMs": 60000,
    "enforceForFinancial": true,
    "checkedAt": "2026-03-21T00:00:00.000Z",
    "detail": "Trusted time synchronized via time.windows.com (offset 12ms).",
    "ntpSource": "time.windows.com",
    "lastSuccessfulSyncAt": "2026-03-21T00:00:00.000Z"
  }
}
```

### `GET /api/admin/print-dispatch/latency`

Returns print dispatcher latency analytics derived from admin logs by correlating:

- `print_dispatch_summary` (dispatch timestamp + MIME/engine), and
- spooler terminal logs (`print_spooler_confirmed`, `print_spooler_job_failed`, `print_spooler_auto_refund`, `print_spooler_monitor_timeout`, `print_spooler_monitor_unavailable`).

Query:

- `maxEvents` (optional, default `5000`, clamped `100..20000`)

Response includes:

- `byMimeType[]` with `p50`, `p95`, and `sampleCount`
- `byEngine[]` with `p50`, `p95`, and `sampleCount`
- `speculation` summary where `confirmed=true` when worst non-PDF p95 is at least 30% higher than PDF p95

### `GET /api/admin/transactions/:transactionId`

Returns a transaction-focused support snapshot for the given reference ID. Response includes:

- `transactionId`
- `mode`
- `chargedAmount`
- `settledAt`
- `spoolerPhase`
- `reconciliationAction`
- `pendingRefunds[]`
- `ledgerEntries[]`
- `relatedLogs[]`

### `GET /api/admin/system/time-sync`

Returns trusted time health. HTTP `200` when trusted time is valid, HTTP `503` when unavailable/drift exceeded and financial enforcement is active.

Response:

```json
{
  "ok": true,
  "trustedTime": {
    "source": "ntp",
    "synced": true,
    "offsetMs": 12,
    "driftExceeded": false,
    "maxDriftMs": 60000,
    "enforceForFinancial": true,
    "checkedAt": "2026-03-21T00:00:00.000Z",
    "detail": "Trusted time synchronized via time.windows.com (offset 12ms).",
    "ntpSource": "time.windows.com",
    "lastSuccessfulSyncAt": "2026-03-21T00:00:00.000Z"
  }
}
```

### `POST /api/admin/hopper/self-test`

Triggers a coin hopper self-test. Returns `{ ok, amount, message, attempts }`.

### `GET /api/admin/settings`

Returns settings. All pricing values are whole-peso integers.

### `PUT /api/admin/settings`

Updates pricing, timeout, PIN, and local-only guard. Pricing fields (`printPerPage`, `copyPerPage`, `scanDocument`, `colorSurcharge`) must be non-negative integers (whole pesos). Fractional values are rejected with `400`.

Supports `consumablesForecasting` updates:

```json
{
  "consumablesForecasting": {
    "enabled": true,
    "rollingWindowDays": 14,
    "alertDaysThreshold": 7,
    "paperTrayCapacitySheets": 100,
    "paperCurrentSheets": 60
  }
}
```

Validation rules:

- `rollingWindowDays`: integer `1..90`
- `alertDaysThreshold`: integer `1..60`
- `paperTrayCapacitySheets`: integer `>= 1`
- `paperCurrentSheets`: integer `>= 0` and must not exceed tray capacity

### `GET /api/admin/consumables/forecast`

Returns the same consumables forecast payload exposed under `/api/admin/summary.consumables`.

### `POST /api/admin/consumables/paper-refill`

Updates paper refill inventory and returns updated forecast.

Request:

```json
{
  "currentSheets": 95,
  "paperTrayCapacitySheets": 100
}
```

`paperTrayCapacitySheets` is optional; when omitted, current configured tray capacity is used.

### `GET /api/admin/printer/list`

Returns installed Windows printer queues plus the currently configured ink-monitoring target.

Response includes:

- `printers[]` entries with:
  - `name`, `driverName`, `portName`, `isDefault`, `printerStatus`, `printerState`
  - `pnpInstanceId` (nullable) — best-effort PnP printer device instance identifier
  - `pnpFriendlyName` (nullable) — matched PnP device display name
  - `deviceSerialNumber` (nullable) — best-effort `DEVPKEY_Device_SerialNumber`
- `targetPrinterName` — configured `inkMonitoring.targetPrinterName`

### `GET /api/admin/printer/ink-diagnostics`

Returns diagnostics for Issue #24 ink monitoring checks, including:

- `targetPrinterName`
- `targetResolved`
- `telemetry`
- `installedPrinters`
- `matchingProperties`
- `targetPrinterIdentity` (nullable) with:
  - `pnpInstanceId`
  - `pnpFriendlyName`
  - `deviceSerialNumber`

`targetPrinterIdentity` helps verify that the configured target queue maps to the expected connected hardware even when a true serial number is not exposed by the driver.

### `GET /api/admin/printer/ink-history`

Returns ink telemetry history snapshots.

- Query: `limit` (`1..500`, default `100`)
- Response: `{ total, items[] }`

### `POST /api/admin/printer/re-detect`

Forces immediate printer re-detection and telemetry refresh. Returns `{ ok, printer }`.

### `POST /api/admin/printer/test-print`

Prints a diagnostic test page to the currently connected printer.

Response includes dispatch timing metadata:

- `timing.totalElapsedMs` — end-to-end request handling time
- `timing.dispatchDurationMs` — dispatcher engine handoff duration
- `timing.dispatchEngine` — selected engine (`sumatra`, `pdftoprinter`, `ghostscript`, `libreoffice`)
- `timing.dispatchAttempts` — number of dispatch attempts in the fallback chain

### `GET /api/admin/logs/system`

Returns **system-only** logs (`?limit=1..1000`, default 200). Transaction-context
entries are excluded.

Legacy alias: `GET /api/admin/logs` points to the same system dataset.

### `GET /api/admin/logs/system/export.csv`

Exports system-only logs as CSV.

Legacy alias: `GET /api/admin/logs/export.csv` exports system-only logs.

### `DELETE /api/admin/logs/system`

Clears only system logs.

Legacy alias: `DELETE /api/admin/logs` clears system logs.

### `GET /api/admin/logs/transactions`

Returns transaction logs for print/copy/scan lifecycle events.

Query parameters:

- `limit` (`1..1000`, default `200`)
- `transactionId` (exact transaction ID match; message fallback match)
- `mode` (`print|copy|scan`)
- `dateFrom` (ISO timestamp)
- `dateTo` (ISO timestamp)
- `eventType` (exact log type match)
- `status` (`created|processing|completed|failed|refund`)

### `GET /api/admin/logs/transactions/export.csv`

Exports transaction logs as CSV (supports the same filters as
`GET /api/admin/logs/transactions`).

### `DELETE /api/admin/logs/transactions`

Clears only transaction logs.

### `POST /api/admin/balance/reset`

Resets balance to `0`.

### `POST /api/admin/storage/clear`

Clears top-level files under upload directory.

### `GET /api/watchdog/health`

Returns watchdog-oriented machine health for local self-healing.
Auth/Access: loopback-only (`127.0.0.1`/`::1`), no admin PIN.

- `200` when overall watchdog status is `healthy` or `degraded`
- `503` when overall watchdog status is `unhealthy`

Response shape:

```json
{
  "status": "healthy",
  "checkedAt": "2026-03-21T12:00:00.000Z",
  "process": {
    "pid": 12345,
    "uptimeSeconds": 421,
    "startedAt": "2026-03-21T11:53:00.000Z"
  },
  "monitor": {
    "appHeartbeatIntervalMs": 1000,
    "componentPollIntervalMs": 5000
  },
  "externalWatchdog": {
    "running": true,
    "watchdogPid": 22048,
    "consecutiveFailures": 0,
    "recoveryAttempts": 2,
    "backoffDelayMs": 0,
    "nextRecoveryAt": null,
    "lastAction": "health_ok",
    "lastError": null,
    "lastUpdatedAt": "2026-03-21T12:00:00.000Z"
  },
  "components": {
    "app": {
      "status": "healthy",
      "detail": "App heartbeat monitor started.",
      "lastHeartbeatAt": "2026-03-21T12:00:00.000Z",
      "staleAfterMs": 20000,
      "stale": false,
      "staleForMs": 532,
      "context": {}
    }
  }
}
```

### `POST /api/watchdog/report`

Loopback-only endpoint (`127.0.0.1`/`::1`) for external watchdog runtime state reporting.
Auth/Access: loopback-only, no admin PIN.

Request body fields:

- `running` (boolean)
- `watchdogPid` (number|null)
- `consecutiveFailures` (number)
- `recoveryAttempts` (number)
- `backoffDelayMs` (number)
- `nextRecoveryAt` (string|null)
- `lastAction` (string)
- `lastError` (string|null)

Response:

- Latest normalized watchdog state persisted in memory and surfaced in admin status payloads.

### `GET /api/watchdog/report`

Returns the latest normalized external watchdog state that was reported by the watchdog loop.
Auth/Access: loopback-only (`127.0.0.1`/`::1`), no admin PIN.

### `GET /api/admin/owed-changes`

Returns all owed change entries with counts: `{ total, openCount, resolvedCount, entries[] }`. Each entry has `id`, `timestamp`, `amount`, `reason`, `status` ("open"|"resolved"), and optional `meta`.

### `POST /api/admin/owed-changes/:id/resolve`

Marks a single owed change entry as resolved. Returns `{ ok, entry }`. Returns `404` if not found, `409` if already resolved.

### `POST /api/admin/owed-changes/resolve-all`

Bulk-resolves all open owed change entries. Returns `{ ok, resolvedCount }`.

## Installation notes

Before testing API routes that interact with hardware, complete the setup checklist in [INSTALLATIONS.md](./INSTALLATIONS.md).
