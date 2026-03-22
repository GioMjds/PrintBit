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

## Coins not updating

- Verify serial cable and COM availability.
- Ensure no other application is occupying the COM port.
- Check admin/system status for serial error details.

## Upload session not resolving

- Ensure phone is connected to kiosk Wi-Fi.
- Confirm tokenized route `/upload/:token` is reachable.
- Retry session creation from kiosk print page.

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
- Scanned files in `uploads/scans` are auto-cleaned based on `PRINTBIT_SCAN_FILE_RETENTION_MS` (default 24 hours).
- Back up `printbit.sqlite` before maintenance.
- Use admin endpoints to clear storage instead of manual destructive deletes when possible.

## Install/software dependency reference

Use [INSTALLATION_AND_DEPENDENCIES.md](./INSTALLATION_AND_DEPENDENCIES.md) as the primary source for software installation and dependency verification.
