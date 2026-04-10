# Windows Kiosk Lockdown Setup & Installation Guide (Issue #38)

This guide is for preparing a **Windows tablet** for PrintBit kiosk deployment with lockdown controls.

## 1) Target environment

- Windows 10/11 tablet (kiosk device)
- Dedicated kiosk local user account
- Separate admin/service account for maintenance

## 2) Required software and drivers

Install these first:

- Node.js 20.x LTS
- pnpm `10.13.1`
- Git
- Microsoft Edge (latest stable)
- Print dispatcher binaries available for selected mode:
  - `bin/PDFtoPrinter.exe` (or `PRINTBIT_PDFTOPRINTER_PATH`)
  - GhostScript (`gswin64c.exe`) via PATH or `PRINTBIT_GHOSTSCRIPT_PATH`
  - LibreOffice (`soffice.exe`) via PATH or `PRINTBIT_LIBREOFFICE_PATH`
  - Optional Sumatra fallback (`bin/SumatraPDF.exe` or `PRINTBIT_SUMATRA_PATH`) for phased mode
- Printer driver package (production printer)
- Scanner driver + NAPS2 (`C:\Program Files\NAPS2\NAPS2.Console.exe`)
- Serial/USB drivers for coin acceptor / hopper controller

## 2.1) Windows Time Service & NTP baseline

Trusted financial timestamps require reliable time sync on every kiosk.

- Ensure **Windows Time** service exists and runs automatically:

```powershell
sc config w32time start= auto
Start-Service w32time
```

- Configure an NTP peer (example uses `time.windows.com`):

```powershell
w32tm /config /manualpeerlist:"time.windows.com,0x9" /syncfromflags:manual /update
Restart-Service w32time
```

- Force a sync and verify source/status:

```powershell
w32tm /resync
w32tm /query /status
```

- Confirm `Source` is **not** `Local CMOS Clock` or `Free-running System Clock`.

## 3) PrintBit app installation

From the project root:

```powershell
pnpm install
pnpm run build
pnpm exec tsc --noEmit --ignoreDeprecations 6.0
```

Validate launcher scripts exist:

- `scripts\start-kiosk.ps1`
- `scripts\start-kiosk.bat`
- `scripts\install-startup.ps1`

## 4) Startup automation

Run as Administrator:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-startup.ps1 -AtStartup
```

This installs the scheduled task `PrintBit Kiosk` for machine-start auto-run using the SYSTEM principal (recommended when kiosk and admin users differ).

If kiosk login still cannot load localhost reliably, you can re-register startup specifically for the kiosk user token:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-startup.ps1 -KioskUser ".\PrintBitKiosk"
```

## 5) Lockdown policy target (planned profile)

For Issue #38, target these controls:

- Use **Assigned Access (single-app kiosk)** as primary shell restriction
- Disable escape vectors (task switching/start/task manager/settings/system tray where policy allows)
- Suppress notifications/action center popups
- Block USB mass storage at OS level
- Keep PrintBit scan delivery on wireless/QR path (USB export disabled in lockdown)

## 5.1) App lockdown environment flags

Set these environment values on kiosk startup:

- `PRINTBIT_KIOSK_LOCKDOWN=true`
- `PRINTBIT_USB_EXPORT_ENABLED=false`

These are already set by `scripts\run.bat` and defaulted by kiosk startup scripts.

## 5.2) Apply / verify / revert lockdown scripts

Run as Administrator from project root:

```powershell
pnpm run lockdown:apply
pnpm run lockdown:verify
```

For maintenance windows:

```powershell
pnpm run lockdown:revert
```

Then re-apply and verify before returning the device to public use.

## 5.3) Controlled Windows update policy (Issue #39)

Run as Administrator from project root:

```powershell
pnpm run updates:apply
pnpm run updates:verify
```

Defaults applied by `updates:apply`:

- Feature update defer: 30 days
- Quality update defer: 7 days
- Driver updates excluded from Windows Update quality updates
- Scheduled install: Sunday at 03:00
- No automatic reboot while users are logged on

To tune maintenance window values when needed:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\apply-controlled-updates.ps1 -FeatureDeferDays 30 -QualityDeferDays 7 -MaintenanceInstallDay 0 -MaintenanceInstallHour 3
```

For rollback during troubleshooting:

```powershell
pnpm run updates:revert
```

## 5.4) Printer driver version pinning

1. Update `scripts\printer-driver-baseline.json` with production values (exact match policy).
2. Verify driver pin:

```powershell
pnpm run driver:verify
```

Helpful command to collect current default-printer details before editing baseline:

```powershell
$p = Get-CimInstance Win32_Printer | ? Default
$d = Get-CimInstance Win32_PrinterDriver -Filter ("Name='" + $p.DriverName.Replace("'","''") + "'")
$p | Select-Object Name,DriverName
$d | Select-Object Name,DriverProviderName,DriverVersion
```

## 6) Assigned Access setup checklist (tablet)

1. Create/sign in dedicated kiosk user.
2. Configure Assigned Access to Edge kiosk experience for PrintBit URL.
3. Ensure PrintBit startup task works under kiosk login.
4. Reboot and verify kiosk returns directly to locked app flow.

## 7) Development-phase rehearsal (before tablet transfer)

Run a rehearsal on a Windows dev machine:

1. Apply lockdown profile in test user context.
2. Launch kiosk via `scripts\run.bat` or scheduled task.
3. Verify users cannot escape to desktop/settings/system tools.
4. Verify print/copy/scan core flows still work.
5. Verify USB mass storage is blocked and scan USB export is unavailable.
6. Record pass/fail and remediation notes.

## 8) Validation checklist

- Kiosk auto-start works after reboot
- PrintBit reachable in kiosk mode
- Alt+Tab/Win-key/task switching vectors blocked (as supported by edition/policy)
- Notifications do not disrupt kiosk flow
- Settings/Task Manager inaccessible for kiosk user
- USB storage blocked
- Core transaction flow (upload, pay, print) still succeeds

## 9) Maintenance / break-glass expectations

- Use admin/service account only for updates and troubleshooting.
- Keep a documented rollback path to temporarily relax lockdown for servicing.
- Re-apply lockdown after maintenance and re-run validation checklist.
- Re-apply controlled update policy (`pnpm run updates:apply`) and verify (`pnpm run updates:verify`) after servicing.
- Re-run driver pin verification (`pnpm run driver:verify`) before returning to public operation.

## 10) Notes

- Shell Launcher can be considered only if Windows edition supports it and Assigned Access is insufficient.
- This guide is paired with `plan.md` tasks for implementing scripts, app-level USB gating, and formal verification artifacts.
- `apply-kiosk-lockdown.ps1` includes an optional `-DisableWinKeys` flag to apply Scancode Map key blocking (requires reboot).
