# PrintBit Operations Runbook

## Start and stop

- Start dev server: `pnpm dev`
- Build client bundle: `pnpm build`
- Type-check: `pnpm exec tsc --noEmit`
- Run one-time legacy JSON->SQLite import: `pnpm run db:migrate:legacy`
- Force rerun legacy import (clears import marker): `pnpm run db:migrate:legacy -- --force`
- Apply controlled updates policy: `pnpm run updates:apply`
- Verify controlled updates policy: `pnpm run updates:verify`
- Revert controlled updates policy: `pnpm run updates:revert`
- Verify printer driver pin: `pnpm run driver:verify`
- Install watchdog scheduled tasks: `pnpm run watchdog:install`
- Verify watchdog secondary monitor: `pnpm run watchdog:verify`
- Uninstall watchdog scheduled tasks: `pnpm run watchdog:uninstall`
- Install startup trigger at machine boot: `powershell -ExecutionPolicy Bypass -File .\scripts\install-startup.ps1 -AtStartup`
- Install watchdog at machine boot: `powershell -ExecutionPolicy Bypass -File .\scripts\install-watchdog.ps1 -AtStartup`

## Pre-flight checklist (kiosk)

1. `bin/SumatraPDF.exe` exists.
2. Printer is installed and has a default printer selected.
3. Serial coin hardware is connected (if coin mode is used).
4. Scanner is connected (for copy/scan features).
5. MyPublicWiFi is installed (if hotspot/captive flow is enabled).
6. NAPS2 is installed (`C:\Program Files\NAPS2\NAPS2.Console.exe`) with Epson scanner drivers.
7. Windows Time (`W32Time`) is running and synced to NTP (`w32tm /query /status`).

## Common checks

- Balance API: `GET /api/balance`
- Pricing API: `GET /api/pricing`
- Active session API: `GET /api/session/active`
- Admin summary (requires PIN header): `GET /api/admin/summary`

## Controlled Windows and driver updates (Issue #39)

### Baseline setup

1. Populate `scripts\printer-driver-baseline.json` with production values for the kiosk default printer.
2. Ensure baseline uses exact versions from a known-good printer + driver combination.

### Staged rollout process (one-kiosk canary first)

1. Select one kiosk as canary and back up critical runtime state:
   - **SQLite database:** Copy `printbit.sqlite` (and .sqlite-shm/.sqlite-wal if present) to a timestamped backup directory.
   - **Uploads directory:** Copy the entire `uploads/` directory to preserve queued documents and scans.
   - Verify backup integrity by checking file sizes and testing SQLite file with `sqlite3 backup.sqlite "PRAGMA integrity_check;"` before proceeding.
2. Apply update controls:
   - `pnpm run updates:apply`
   - `pnpm run updates:verify`
3. Validate driver pin:
   - `pnpm run driver:verify`
4. Perform maintenance-window OS update and printer-driver servicing on canary only.
5. Run post-update functional checks:
   - Print upload/pay/print flow
   - Coin acceptance + balance updates
   - Scanner flow if enabled
6. If all checks pass, proceed kiosk-by-kiosk for the rest of the fleet.

### Rollback if print pipeline breaks

1. Revert update controls to original state:
   - `pnpm run updates:revert`
2. Roll back printer driver using Device Manager / vendor installer to known-good version from baseline.
3. Re-run:
   - `pnpm run driver:verify`
   - `pnpm run updates:verify` (after re-applying policy if returning to managed mode)
4. Validate full transaction flow before returning kiosk to production.

## Definition of Done (mandatory): Epson L5290 spooler handoff reliability

All sections below must pass before closing spooler handoff reliability work.

### 1) Queue identity and USB port mapping verification

1. Run `GET /api/admin/printer/list`.
2. Confirm the active queue is the production Epson L5290 queue, `isDefault=true`, and `portName` matches the expected USB port (typically `USB001`).
3. Record `name`, `driverName`, `portName`, and `pnpInstanceId` in the ticket/change log.
4. If mapping is wrong or missing, run `POST /api/admin/printer/re-detect`, then re-verify before proceeding.

### 2) Windows spooler health and queue observation

1. Verify spooler is healthy: `Get-Service Spooler` must be `Running`.
2. Clear stale/paused Epson queue jobs.
3. Run `POST /api/admin/printer/test-print`, then run one real kiosk print transaction.
4. Observe queue progression (`Get-PrintJob -PrinterName "<EPSON L5290 queue name>"`) until jobs leave queue and printer output is produced.
5. If jobs stall/fail, capture timestamp + queue state and treat checklist as failed.

### 3) Physical printer checks (on-device)

1. Confirm printer panel has no active errors (jam, cover open, out of paper/ink).
2. Confirm paper path and tray are loaded/aligned for expected media size.
3. Run nozzle check; if gaps/streaks appear, run head cleaning and repeat nozzle check.
4. Print maintenance/test pattern and confirm readable, streak-free output.

### 4) USB cable and driver stability across reconnect/restart

1. Inspect and secure USB cable at both printer and host ends.
2. Perform one controlled USB reconnect (unplug/replug) and verify Epson queue returns online with same port mapping.
3. Reboot host once; verify spooler is running, Epson queue still default, and test print succeeds.
4. Confirm no Device Manager warning state for Epson/USB print devices after reconnect/restart.

### 5) Transaction/reference ID correlation to physical output

1. Run at least 2 test print transactions.
2. Capture each `transactionId` (reference ID) from kiosk/admin flow.
3. For each ID, query `GET /api/admin/transactions/:transactionId` and confirm expected settlement fields with terminal `spoolerPhase`.
4. Mark each physical printout with its `transactionId` + timestamp (or attach photo evidence) for audit trace.
5. Do not mark spooler handoff work done unless every sampled `transactionId` has matching successful spooler/admin evidence and physical output.

## Frequent issues

## Watchdog & self-healing (Issue #40)

- Health endpoint: `GET /api/watchdog/health` (loopback polling target for local watchdog).
- Watchdog loop script: `scripts/watchdog.ps1`
- Secondary watchdog verifier: `scripts/verify-watchdog.ps1`
- Task installer: `scripts/install-watchdog.ps1`

### Install on kiosk

1. Run `pnpm run watchdog:install` from elevated PowerShell.
2. Confirm Scheduled Tasks exist:
   - `PrintBit Watchdog`
   - `PrintBit Watchdog Verifier`
3. Optional one-shot smoke run: `pnpm run watchdog:run-once`
4. Verify heartbeat file is updating:
   - `uploads/watchdog/watchdog-heartbeat.json`
5. For power-loss resilience, prefer startup trigger installs:
   - `powershell -ExecutionPolicy Bypass -File .\scripts\install-startup.ps1 -AtStartup`
   - `powershell -ExecutionPolicy Bypass -File .\scripts\install-watchdog.ps1 -AtStartup`

## Power loss, reboot & crash recovery (Issue #37)

### Software recovery behavior

- At process startup, PrintBit records startup lifecycle markers in persistent runtime state.
- If previous startup has no corresponding clean shutdown marker, startup reports `unexpected_restart_detected` in admin/anomaly logs.
- Startup reconciliation scans in-flight payment sessions and applies policy:
  - pre-settlement sessions are voided;
  - settled print sessions without final spooler outcome are auto-refunded by default;
  - any refund blocked by trusted-time enforcement remains unresolved and visible for admin review.

### Hardware & production field SOP

1. Use a UPS sized for kiosk tablet/mini-PC + printer + networking to prevent abrupt power cuts.
2. Configure BIOS/UEFI to restore power automatically after AC loss (`Restore on AC Power Loss = Power On`).
3. Use surge protection and secure power/USB cable retention in enclosure.
4. After any unplanned reboot:
   - check `GET /api/admin/summary` for `recoveryStats` and refund/open counts;
   - verify watchdog status and heartbeat freshness;
   - run one end-to-end transaction test before returning kiosk to service.
5. If unresolved recovery sessions remain (e.g., trusted time blocked), technician should restore time sync and re-check pending refunds from admin panel before reopening.

### Runtime behavior

- Watchdog polls `/api/watchdog/health` every `PRINTBIT_WATCHDOG_POLL_INTERVAL_MS` (default 5000ms).
- If health is unreachable or returns `unhealthy`, watchdog restarts the server and ensures Edge kiosk relaunch.
- Repeated failures use exponential backoff:
  - `PRINTBIT_WATCHDOG_RESTART_BASE_DELAY_MS` (default 2000)
  - `PRINTBIT_WATCHDOG_RESTART_MAX_DELAY_MS` (default 60000)
- Escalation threshold:
  - `PRINTBIT_WATCHDOG_FAILURE_ALERT_THRESHOLD` (default 5)
  - Escalation/restore events are reported through anomaly/admin logs.

### Secondary monitor

- `PrintBit Watchdog Verifier` checks watchdog heartbeat freshness.
- If stale, it restarts the watchdog task automatically.
- Default stale threshold is 180000ms inside `verify-watchdog.ps1`.

## Print fails

- Verify `bin/SumatraPDF.exe` path and permissions.
- Confirm uploaded file exists in `uploads/`.
- Check default Windows printer status.

## Ink / toner levels show "N/A"

- Most consumer and office printers do not expose per-cartridge fill levels through Windows WMI/CIM.
- If the admin System page shows "N/A" for ink, the printer driver does not report supply data to Windows.
- Printers that expose `DetectedErrorState` may still show "Low" or "Empty" alerts even without exact percentages.
- Telemetry is queried from the Windows default printer only; ensure the correct printer is set as default.

### Epson L5290 software setup for ink telemetry (Wi-Fi/LAN first)

1. Install the official Epson L5290 driver package on the kiosk host and confirm the queue appears in Windows Printers.
2. Ensure the printer and kiosk are on the same LAN and the queue uses a stable network port/IP.
3. In PrintBit admin, open **System** and verify `/api/admin/printer/list` shows the expected Epson queue identity.
4. In PrintBit admin settings, explicitly **enable Consumables Forecasting** (`consumablesForecasting.enabled = true`) before saving, then set rolling window, alert threshold, and tray capacity/current sheets.  
   - Fresh kiosks default this flag to `false` (`src/core/database/db.ts`, `DEFAULT_DATA.settings.consumablesForecasting.enabled`), so toggle it on first.
   - API alternative: `PUT /api/admin/settings` with `{ "consumablesForecasting": { "enabled": true, ... } }`.
5. If ink telemetry is not immediately visible, run `POST /api/admin/printer/re-detect` and re-check (after enabling forecasting):
   - `/api/admin/printer/ink-diagnostics`
   - `/api/admin/printer/ink-history`
   - `/api/admin/consumables/forecast`
6. Use SNMP-capable network queue/driver configuration where possible; fallback methods can report lower-confidence ink estimates.

## Coins not updating

- Verify serial cable and COM availability.
- Ensure no other application is occupying the COM port.
- Check admin/system status for serial error details.

## Upload session not resolving

- Ensure phone is connected to kiosk Wi-Fi.
- Confirm tokenized route `/upload/:token` is reachable.
- Retry session creation from kiosk print page.

### ESP32 captive portal checks

- When using ESP32 onboarding, set `PRINTBIT_NETWORK_PROVIDER=esp32`.
- Align AP values with firmware (`SSID=PrintBit`, password/auth must match).
- In ESP32 `.ino`, expose `POST /kiosk/register` so the kiosk can dynamically publish its current IP and captive path.
- Keep `PRINTBIT_ESP32_AP_BASE_URL` pointed to the ESP32 AP gateway (default `http://192.168.4.1`).
- Validate end-to-end:
  - Start a new print session on kiosk (`/print`)
  - Scan QR and join ESP32 AP
  - Phone captive portal opens and reaches PrintBit upload page
  - Upload appears in kiosk file list for the active session

## Scanner preview fails

- Confirm scanner is available and not in use.
- Retry `/api/scan/preview`.
- Check logs for `scan_preview_failed` entries.

## Scan soft-copy delivery fails

- Check scanner readiness from `GET /api/scanner/status`.
- For wireless delivery, regenerate the link from `POST /api/scanner/wireless-link` and retry `/scan/download/:token`.
- In kiosk lockdown mode, USB export routes are disabled and return `423` with `code: "USB_EXPORT_DISABLED"`.

## Storage and state safety

- Runtime artifacts:
  - `uploads/`
  - `printbit.sqlite`
- Legacy `db.json` import is idempotent and marker-guarded; use the force command only during controlled migration recovery.
- Transient print uploads are deleted after successful completion (`/print` legacy success or spooler-confirmed modern print success) and on wireless session cancel/timeout.
- Transient scan/copy files under `uploads/scans` are released on scan QR **Done**, copy success, and timeout/cancel flows.
- Startup crash-recovery cleanup purges stale transient upload + scan files older than `PRINTBIT_TRANSIENT_FILE_STARTUP_RETENTION_MS` (default 30 minutes).
- Periodic scan retention cleanup still runs using `PRINTBIT_SCAN_FILE_RETENTION_MS` (default 24 hours) as a fallback safety net.
- Back up `printbit.sqlite` before maintenance.
- Use admin endpoints to clear storage instead of manual destructive deletes when possible.

## Install/software dependency reference

Use [INSTALLATION_AND_DEPENDENCIES.md](./INSTALLATION_AND_DEPENDENCIES.md) as the primary source for software installation and dependency verification.
